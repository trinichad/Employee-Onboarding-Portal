from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import is_approver, require_org_admin, require_org_approver, require_org_member
from app.db.session import get_db
from app.models import EmployeeRequest, FormSchema, Organization, OrgResource, RequestStatus, Role, User
from app.schemas import EmployeeRequestCreate, EmployeeRequestOut, EmployeeRequestUpdate
from app.services.audit import audit
from app.services.sender import org_sender, org_smtp
from app.services.email import (
    approval_request_email,
    approved_notification_email,
    support_submission_email,
)

router = APIRouter(prefix="/orgs/{org_slug}/requests", tags=["requests"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _request_link(db: Session, org: Organization, request_id: int) -> str:
    from app.services.runtime import public_base_url
    return f"{public_base_url(db)}/{org.slug}/requests/{request_id}"


def _approver_emails(db: Session, org_id: int) -> list[str]:
    rows = (
        db.query(User)
        .filter(User.organization_id == org_id, User.is_active == True)  # noqa: E712
        .all()
    )
    out: list[str] = []
    for u in rows:
        if u.role in (Role.GLOBAL_ADMIN, Role.CLIENT_ADMIN) or bool(getattr(u, "can_approve_requests", False)):
            out.append(u.email)
    return out


def _payload_text(payload: dict) -> str:
    try:
        return json.dumps(payload, indent=2, sort_keys=True)
    except Exception:
        return str(payload)


def _format_date_mdy(s: str) -> str:
    import re
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s or "")
    return f"{m.group(2)}/{m.group(3)}/{m.group(1)}" if m else s


def _is_filled(v) -> bool:
    if v is None:
        return False
    if isinstance(v, str):
        return v.strip() != ""
    if isinstance(v, (list, tuple, dict)):
        return len(v) > 0
    return True


def _resources_by_id(db: Session, organization_id: int) -> dict[int, OrgResource]:
    rows = db.query(OrgResource).filter(OrgResource.organization_id == organization_id).all()
    return {r.id: r for r in rows}


def _substitute(text: str, placeholder: str, name: Optional[str]) -> str:
    if not text or not name:
        return text
    # Case-insensitive replace.
    import re
    return re.sub(re.escape(placeholder), name, text, flags=re.IGNORECASE)


def _resolve_resource_name(value, resources: dict[int, OrgResource]) -> Optional[str]:
    """Look up a resource id (int or numeric string) and return its name."""
    if value is None:
        return None
    try:
        rid = int(value)
    except (TypeError, ValueError):
        return None
    r = resources.get(rid)
    return r.name if r else None


def _summary_lines(
    payload: dict,
    schema: Optional[dict],
    resources: Optional[dict[int, OrgResource]] = None,
) -> List[str]:
    """Render the request payload as labeled 'Label: value' lines using the
    org's form schema, mirroring the frontend Summary card. When a resource
    catalog is provided, resource fields and dynamic-group placeholders are
    resolved to human-readable names."""
    payload = payload or {}
    schema = schema or {}
    resources = resources or {}
    lines: List[str] = []

    def _is_truthy_attr(v) -> bool:
        if v is True:
            return True
        if v is False or v is None:
            return False
        s = str(v).strip().lower()
        if not s:
            return False
        if s in {"no", "false", "0", "n", "off", "-"}:
            return False
        return True

    def _eval_visible(cond: dict, resource: Optional[OrgResource]) -> bool:
        """Mirror FormRenderer.evalGroupVisible. Returns True iff the group
        (or per-instance dynamic block) should be included in the summary."""
        if not cond:
            return True
        if resource is None:
            return bool(cond.get("negate"))
        raw = (getattr(resource, "attributes", None) or {}).get(cond.get("attribute"))
        passed = True
        truthy = cond.get("truthy")
        equals = cond.get("equals")
        if truthy is True:
            passed = passed and _is_truthy_attr(raw)
        if equals is not None:
            norm = lambda v: str(v if v is not None else "").strip().lower()
            want = [norm(x) for x in equals] if isinstance(equals, list) else [norm(equals)]
            passed = passed and (norm(raw) in want)
        if truthy is None and equals is None:
            passed = _is_truthy_attr(raw)
        return (not passed) if cond.get("negate") else passed

    def _resource_for_field(fid: Optional[str]) -> Optional[OrgResource]:
        if not fid:
            return None
        val = payload.get(fid)
        try:
            rid = int(val)
        except (TypeError, ValueError):
            return None
        return resources.get(rid)

    rt = payload.get("request_type")
    if _is_filled(rt):
        lines.append(f"Request Type: {rt}")

    # Prior-access review annotations (Promotion-style requests). When the
    # submitter ran an employee lookup and tagged previously-granted items
    # Keep / Remove, surface those decisions next to each tracked line so
    # reviewers know what to revoke vs carry forward.
    prior_snap = payload.get("_prior_snapshot") or {}
    prior_actions = payload.get("_prior_actions") or {}
    prior_snap_fields = prior_snap.get("fields") or {}
    prior_snap_groups = prior_snap.get("groups") or {}
    prior_act_fields = prior_actions.get("fields") or {}
    prior_act_groups = prior_actions.get("groups") or {}

    def _field_tag(fid: str) -> str:
        if fid not in prior_snap_fields:
            return ""
        action = prior_act_fields.get(fid, "keep")
        return "  [REMOVE PREVIOUS ACCESS]" if action == "remove" else "  [keep previous]"

    def _item_tag(gid: str, ctx_key: str, item_id: str) -> str:
        ctxs = prior_snap_groups.get(gid) or {}
        if item_id not in (ctxs.get(ctx_key) or {}):
            return ""
        action = ((prior_act_groups.get(gid) or {}).get(ctx_key) or {}).get(item_id, "keep")
        return " [REMOVE]" if action == "remove" else " [keep prior]"

    fields = schema.get("fields") or []
    fields_by_id = {f.get("id"): f for f in fields}

    for f in fields:
        v = payload.get(f.get("id"))
        if not _is_filled(v):
            continue
        if f.get("type") == "date":
            value = _format_date_mdy(str(v))
        elif f.get("type") == "resource":
            value = _resolve_resource_name(v, resources) or str(v)
        else:
            value = str(v)
        lines.append(f"{f.get('label') or f.get('id')}: {value}{_field_tag(f.get('id') or '')}")

    groups_payload = payload.get("_groups") or {}
    for g in (schema.get("groups") or []):
        if not g.get("enabled"):
            continue
        gid = g.get("id")
        raw = groups_payload.get(gid)
        if not raw:
            continue

        visible_when = g.get("visible_when") or None
        dyn = g.get("dynamic")
        if dyn:
            placeholder = dyn.get("placeholder") or "{Property}"
            source_field_id = dyn.get("source_field_id")
            source_val = payload.get(source_field_id) if source_field_id else None
            default_name = _resolve_resource_name(source_val, resources)
            if default_name is None and isinstance(source_val, str) and source_val.strip():
                default_name = source_val
            # Resolve the actual OrgResource (when present) for per-instance
            # visibility checks against the source field's selection.
            default_resource = _resource_for_field(source_field_id)
            # Normalize raw to {default, extras}.
            if isinstance(raw, dict) and ("default" in raw or "extras" in raw):
                default_sel = raw.get("default") or {}
                extras = raw.get("extras") or []
            else:
                default_sel = raw if isinstance(raw, dict) else {}
                extras = []

            def _items_for(sel: dict, name: Optional[str], ctx_key: str) -> list[str]:
                out = []
                for it in (g.get("items") or []):
                    if sel.get(it.get("id")):
                        label = _substitute(it.get("label") or "", placeholder, name)
                        out.append(f"{label}{_item_tag(gid, ctx_key, it.get('id') or '')}")
                return out

            def _title_for(name: Optional[str]) -> str:
                return _substitute(g.get("title") or gid, placeholder, name)

            default_items = _items_for(default_sel, default_name, "default")
            # When `visible_when.keep_picker` is set the dynamic group is
            # picker-only: the default block is suppressed regardless of
            # whether the primary resource passes the rule (it would just
            # duplicate another group). User-added extras are still
            # emitted for any resources that pass the rule.
            keep_picker = bool((visible_when or {}).get("keep_picker"))
            if default_items and not keep_picker and _eval_visible(visible_when, default_resource):
                lines.append(f"{_title_for(default_name)}: {', '.join(default_items)}")
            for ex in extras:
                if not isinstance(ex, dict):
                    continue
                rid = ex.get("resource_id")
                ex_name = _resolve_resource_name(rid, resources)
                ex_resource = resources.get(rid) if isinstance(rid, int) else None
                if not _eval_visible(visible_when, ex_resource):
                    continue
                items = _items_for(ex.get("items") or {}, ex_name, f"extra:{rid}")
                if items:
                    title = _title_for(ex_name) if ex_name else f"{_title_for(None)} (resource #{rid})"
                    lines.append(f"{title}: {', '.join(items)}")
            continue

        # Plain (non-dynamic) group.
        if visible_when and not _eval_visible(
            visible_when, _resource_for_field(visible_when.get("source_field_id"))
        ):
            continue
        sel = raw if isinstance(raw, dict) else {}
        labels = [
            f"{it.get('label')}{_item_tag(gid, 'default', it.get('id') or '')}"
            for it in (g.get("items") or [])
            if sel.get(it.get("id"))
        ]
        if labels:
            lines.append(f"{g.get('title') or gid}: {', '.join(labels)}")

    return lines


def _active_schema(db: Session, organization_id: int) -> Optional[dict]:
    row = (
        db.query(FormSchema)
        .filter(FormSchema.organization_id == organization_id, FormSchema.is_active.is_(True))
        .order_by(FormSchema.version.desc())
        .first()
    )
    return row.schema if row else None


@router.get("", response_model=List[EmployeeRequestOut])
def list_requests(
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
    status: Optional[RequestStatus] = Query(None),
    q: Optional[str] = Query(None, description="Search subject/request_type"),
    mine_only: bool = Query(False),
) -> List[EmployeeRequestOut]:
    org, current = bound
    query = db.query(EmployeeRequest).filter(EmployeeRequest.organization_id == org.id)
    if status is not None:
        query = query.filter(EmployeeRequest.status == status)
    if q:
        like = f"%{q.lower()}%"
        # Cast payload (JSON) to text for substring search across filled-in values.
        from sqlalchemy import cast, String as SAString
        query = query.filter(
            (EmployeeRequest.subject.ilike(like))
            | (EmployeeRequest.request_type.ilike(like))
            | (cast(EmployeeRequest.payload, SAString).ilike(like))
            | (EmployeeRequest.notes.ilike(like))
            | (EmployeeRequest.support_message.ilike(like))
        )
    # All org members can view all requests in their org (prevents duplicate
    # submissions). Use mine_only=true to opt into a personal view.
    if mine_only:
        query = query.filter(EmployeeRequest.submitter_id == current.user.id)
    rows = query.order_by(EmployeeRequest.created_at.desc()).all()
    return [EmployeeRequestOut.model_validate(r) for r in rows]


@router.post("", response_model=EmployeeRequestOut, status_code=201)
def create_request(
    body: EmployeeRequestCreate,
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
) -> EmployeeRequestOut:
    org, current = bound

    # Server-side required-field validation against the org's active schema.
    active = (
        db.query(FormSchema)
        .filter(FormSchema.organization_id == org.id, FormSchema.is_active.is_(True))
        .order_by(FormSchema.version.desc())
        .first()
    )
    if active and isinstance(active.schema, dict):
        rt = body.request_type
        payload = body.payload or {}
        for f in (active.schema.get("fields") or []):
            if not isinstance(f, dict) or not f.get("required"):
                continue
            allow = f.get("visible_when_request_type_in")
            if isinstance(allow, list) and allow and rt not in allow:
                continue
            v = payload.get(f.get("id"))
            empty = v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, list) and len(v) == 0)
            if empty:
                raise HTTPException(status_code=422, detail=f'"{f.get("label") or f.get("id")}" is required.')

    # When the org has approval disabled, requests are auto-approved on
    # creation so the submitter can send them straight to support — no
    # approver action (or notification email) needed.
    approval_required = bool(getattr(org, "require_approval", True))
    row = EmployeeRequest(
        organization_id=org.id,
        submitter_id=current.user.id,
        request_type=body.request_type,
        subject=body.subject or body.request_type,
        payload=body.payload,
        notes=body.notes,
        support_message=body.support_message,
        status=RequestStatus.PENDING_APPROVAL if approval_required else RequestStatus.PENDING_SUBMITTAL,
    )
    db.add(row)
    db.flush()
    audit(db, actor_id=current.user.id, action="request.create", organization_id=org.id,
          target_type="employee_request", target_id=row.id)
    db.commit()
    db.refresh(row)

    if not approval_required:
        # No approvers to notify; the request is ready to send.
        return EmployeeRequestOut.model_validate(row)

    submitter_label = f"{current.user.full_name} <{current.user.email}>"
    link = _request_link(db, org, row.id)
    sender_addr, sender_name = org_sender(db, org)
    smtp_cfg = org_smtp(db, org)
    for email in _approver_emails(db, org.id):
        if email == current.user.email:
            continue
        approval_request_email(email, org.name, row.id, row.subject or row.request_type,
                               submitter_label, link,
                               from_addr=sender_addr, from_name=sender_name, smtp=smtp_cfg)

    return EmployeeRequestOut.model_validate(row)


def _load(db: Session, org_id: int, request_id: int) -> EmployeeRequest:
    row = db.get(EmployeeRequest, request_id)
    if not row or row.organization_id != org_id:
        raise HTTPException(status_code=404, detail="Request not found")
    return row


@router.get("/{request_id}", response_model=EmployeeRequestOut)
def get_request(request_id: int, bound=Depends(require_org_member), db: Session = Depends(get_db)):
    org, current = bound
    row = _load(db, org.id, request_id)
    return EmployeeRequestOut.model_validate(row)


@router.patch("/{request_id}", response_model=EmployeeRequestOut)
def update_request(
    request_id: int,
    body: EmployeeRequestUpdate,
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
):
    org, current = bound
    row = _load(db, org.id, request_id)

    is_admin = current.role in (Role.GLOBAL_ADMIN, Role.CLIENT_ADMIN)
    is_submitter = row.submitter_id == current.user.id
    if not is_admin and not is_submitter:
        raise HTTPException(status_code=403, detail="Forbidden")

    # Status is lifecycle-managed: changes happen via the dedicated approve /
    # reject / submit / resubmit endpoints, never through this PATCH. Manual
    # status edits used to bypass submitted_at / first_submitted_at bookkeeping,
    # which broke the edited_after_submit + resubmit flow.
    # Track whether substantive (emailed) fields change after the request was sent
    # to support, so reviewers can see it diverges from what support received.
    already_sent = row.submitted_at is not None
    content_changed = False
    if body.subject is not None and body.subject != row.subject:
        row.subject = body.subject
        content_changed = True
    elif body.subject is not None:
        row.subject = body.subject
    if body.payload is not None:
        if body.payload != row.payload:
            content_changed = True
        row.payload = body.payload
    if body.notes is not None:
        row.notes = body.notes  # internal-only, does not flip edited_after_submit
    if body.support_message is not None:
        if (body.support_message or "") != (row.support_message or ""):
            content_changed = True
        row.support_message = body.support_message
    if already_sent and content_changed:
        row.edited_after_submit = True
    audit(db, actor_id=current.user.id, action="request.update", organization_id=org.id,
          target_type="employee_request", target_id=row.id)
    db.commit()
    db.refresh(row)
    return EmployeeRequestOut.model_validate(row)


@router.post("/{request_id}/approve", response_model=EmployeeRequestOut)
def approve_request(
    request_id: int,
    bound=Depends(require_org_approver),
    db: Session = Depends(get_db),
):
    org, current = bound
    row = _load(db, org.id, request_id)
    if row.status != RequestStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=409, detail=f"Request is not awaiting approval (status: {row.status.value})")
    row.status = RequestStatus.PENDING_SUBMITTAL
    row.approved_by_id = current.user.id
    row.approved_at = _now()
    audit(db, actor_id=current.user.id, action="request.approve", organization_id=org.id,
          target_type="employee_request", target_id=row.id)
    db.commit()
    db.refresh(row)

    submitter = db.get(User, row.submitter_id) if row.submitter_id else None
    if submitter and submitter.email and submitter.id != current.user.id:
        sender_addr, sender_name = org_sender(db, org)
        approved_notification_email(
            submitter.email, org.name, row.id, row.subject or row.request_type,
            current.user.full_name or current.user.email, _request_link(db, org, row.id),
            from_addr=sender_addr, from_name=sender_name, smtp=org_smtp(db, org),
        )
    return EmployeeRequestOut.model_validate(row)


@router.post("/{request_id}/reject", response_model=EmployeeRequestOut)
def reject_request(
    request_id: int,
    bound=Depends(require_org_approver),
    db: Session = Depends(get_db),
):
    org, current = bound
    row = _load(db, org.id, request_id)
    if row.status not in (RequestStatus.PENDING_APPROVAL, RequestStatus.PENDING_SUBMITTAL):
        raise HTTPException(status_code=409, detail="Request cannot be rejected from its current state")
    row.status = RequestStatus.REJECTED
    audit(db, actor_id=current.user.id, action="request.reject", organization_id=org.id,
          target_type="employee_request", target_id=row.id)
    db.commit()
    db.refresh(row)
    return EmployeeRequestOut.model_validate(row)


@router.post("/{request_id}/submit", response_model=EmployeeRequestOut)
def submit_request_to_support(
    request_id: int,
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
):
    """Email the approved request to the org's support address and mark as submitted.

    Allowed for: any approver, OR the original submitter (after approval).
    """
    org, current = bound
    row = _load(db, org.id, request_id)
    if row.status != RequestStatus.PENDING_SUBMITTAL:
        raise HTTPException(status_code=409, detail="Request must be approved before it can be submitted")
    is_submitter = row.submitter_id == current.user.id
    if not (is_approver(current) or is_submitter):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not org.support_email:
        raise HTTPException(status_code=400, detail="Support email is not configured for this organization")

    submitter = db.get(User, row.submitter_id) if row.submitter_id else None
    submitter_label = (
        f"{submitter.full_name} <{submitter.email}>" if submitter else "Unknown"
    )
    sender_addr, sender_name = org_sender(db, org)
    schema = _active_schema(db, org.id)
    resources = _resources_by_id(db, org.id)
    summary_lines = _summary_lines(row.payload or {}, schema, resources) or ["(no fields filled in)"]
    summary = "\n".join(summary_lines)
    # Flip status to SUBMITTED *before* rendering the PDF so the document
    # reflects the post-send state (otherwise the attached PDF would show
    # "Pending Submittal"). Other submit-time fields are set here too so
    # the PDF "Submitted" timestamp matches the email. If sending later
    # fails the db.commit() below is the gate that persists this — an
    # exception before then rolls everything back.
    row.status = RequestStatus.SUBMITTED
    row.submitted_at = _now()
    if row.first_submitted_at is None:
        row.first_submitted_at = row.submitted_at
    row.submitted_by_id = current.user.id
    row.submission_count = (row.submission_count or 0) + 1
    row.edited_after_submit = False
    from app.services.request_pdf import build_request_pdf, pdf_filename_for
    try:
        pdf_bytes = build_request_pdf(db, org, row, summary_lines, submitter)
        pdf_attachment = [(pdf_filename_for(row), "application/pdf", pdf_bytes)]
    except Exception as exc:  # pragma: no cover - never block sending on PDF failure
        print(f"[requests] failed to build PDF attachment for #{row.id}: {exc}", flush=True)
        pdf_attachment = None
    support_submission_email(
        to=org.support_email,
        org_name=org.name,
        request_id=row.id,
        subject=row.subject or row.request_type,
        request_type=row.request_type,
        submitter=submitter_label,
        payload_text=summary,
        message=row.support_message,
        from_addr=sender_addr,
        from_name=sender_name,
        smtp=org_smtp(db, org),
        attachments=pdf_attachment,
    )

    # Update the org-wide employee directory from this submission so future
    # Promotion / Termination / Rehire requests can typeahead and prefill.
    try:
        from app.api.v1.employees import upsert_from_request
        upsert_from_request(db, org, row, schema)
    except Exception:  # pragma: no cover - directory upsert must not break submit
        pass
    audit(db, actor_id=current.user.id, action="request.submit_to_support", organization_id=org.id,
          target_type="employee_request", target_id=row.id, meta={"to": org.support_email})
    db.commit()
    db.refresh(row)
    return EmployeeRequestOut.model_validate(row)


@router.post("/{request_id}/resubmit", response_model=EmployeeRequestOut)
def resubmit_request_to_support(
    request_id: int,
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
):
    """Re-email an already-submitted request after edits, marking it as an updated
    version so support knows to disregard the previously sent copy.

    Allowed for: any approver, OR the original submitter.
    """
    org, current = bound
    row = _load(db, org.id, request_id)
    if row.submitted_at is None:
        raise HTTPException(status_code=409, detail="Request has not been sent to support yet")
    is_submitter = row.submitter_id == current.user.id
    if not (is_approver(current) or is_submitter):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not org.support_email:
        raise HTTPException(status_code=400, detail="Support email is not configured for this organization")

    submitter = db.get(User, row.submitter_id) if row.submitter_id else None
    submitter_label = (
        f"{submitter.full_name} <{submitter.email}>" if submitter else "Unknown"
    )
    sender_addr, sender_name = org_sender(db, org)
    schema = _active_schema(db, org.id)
    resources = _resources_by_id(db, org.id)
    summary_lines = _summary_lines(row.payload or {}, schema, resources) or ["(no fields filled in)"]
    summary = "\n".join(summary_lines)
    revision = (row.submission_count or 1) + 1
    from app.services.request_pdf import build_request_pdf, pdf_filename_for
    try:
        pdf_bytes = build_request_pdf(db, org, row, summary_lines, submitter)
        pdf_attachment = [(pdf_filename_for(row), "application/pdf", pdf_bytes)]
    except Exception as exc:  # pragma: no cover
        print(f"[requests] failed to build PDF attachment for #{row.id}: {exc}", flush=True)
        pdf_attachment = None
    support_submission_email(
        to=org.support_email,
        org_name=org.name,
        request_id=row.id,
        subject=row.subject or row.request_type,
        request_type=row.request_type,
        submitter=submitter_label,
        payload_text=summary,
        message=row.support_message,
        from_addr=sender_addr,
        from_name=sender_name,
        smtp=org_smtp(db, org),
        is_resubmission=True,
        revision=revision,
        attachments=pdf_attachment,
    )

    row.submitted_at = _now()
    row.submitted_by_id = current.user.id
    row.submission_count = revision
    row.edited_after_submit = False
    try:
        from app.api.v1.employees import upsert_from_request
        upsert_from_request(db, org, row, schema)
    except Exception:  # pragma: no cover
        pass
    # Status remains SUBMITTED/IN_PROGRESS/etc. — do not reset.
    audit(db, actor_id=current.user.id, action="request.resubmit_to_support", organization_id=org.id,
          target_type="employee_request", target_id=row.id,
          meta={"to": org.support_email, "revision": revision})
    db.commit()
    db.refresh(row)
    return EmployeeRequestOut.model_validate(row)


@router.delete("/{request_id}", status_code=204, response_class=Response)
def delete_request(
    request_id: int,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    org, current = bound
    row = _load(db, org.id, request_id)
    db.delete(row)
    audit(db, actor_id=current.user.id, action="request.delete", organization_id=org.id,
          target_type="employee_request", target_id=request_id,
          meta={"subject": row.subject, "status": row.status.value})
    db.commit()


@router.get("/{request_id}/export")
def export_request_pdf(request_id: int, bound=Depends(require_org_member), db: Session = Depends(get_db)):
    org, current = bound
    row = _load(db, org.id, request_id)
    submitter = db.get(User, row.submitter_id) if row.submitter_id else None
    schema = _active_schema(db, org.id)
    resources = _resources_by_id(db, org.id)
    summary = _summary_lines(row.payload or {}, schema, resources) or ["(no fields filled in)"]

    from app.services.request_pdf import build_request_pdf, pdf_filename_for
    pdf = build_request_pdf(db, org, row, summary, submitter)
    return StreamingResponse(
        io.BytesIO(pdf),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{pdf_filename_for(row)}"'},
    )

