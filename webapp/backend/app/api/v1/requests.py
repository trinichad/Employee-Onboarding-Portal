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
from app.models import EmployeeRequest, FormSchema, Organization, RequestStatus, Role, User
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


def _request_link(org: Organization, request_id: int) -> str:
    return f"{settings.PUBLIC_BASE_URL}/{org.slug}/requests/{request_id}"


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


def _summary_lines(payload: dict, schema: Optional[dict]) -> List[str]:
    """Render the request payload as labeled 'Label: value' lines using the
    org's form schema, mirroring the frontend Summary card."""
    payload = payload or {}
    schema = schema or {}
    lines: List[str] = []

    rt = payload.get("request_type")
    if _is_filled(rt):
        lines.append(f"Request Type: {rt}")

    for f in (schema.get("fields") or []):
        v = payload.get(f.get("id"))
        if not _is_filled(v):
            continue
        value = _format_date_mdy(str(v)) if f.get("type") == "date" else str(v)
        lines.append(f"{f.get('label') or f.get('id')}: {value}")

    groups_payload = payload.get("_groups") or {}
    for g in (schema.get("groups") or []):
        if not g.get("enabled"):
            continue
        gid = g.get("id")
        sel = groups_payload.get(gid) or {}
        labels = [it.get("label") for it in (g.get("items") or []) if sel.get(it.get("id"))]
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
    # Standard non-approver users only see their own
    if (current.role == Role.USER and not is_approver(current)) or mine_only:
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
    row = EmployeeRequest(
        organization_id=org.id,
        submitter_id=current.user.id,
        request_type=body.request_type,
        subject=body.subject or body.request_type,
        payload=body.payload,
        status=RequestStatus.PENDING_APPROVAL,
    )
    db.add(row)
    db.flush()
    audit(db, actor_id=current.user.id, action="request.create", organization_id=org.id,
          target_type="employee_request", target_id=row.id)
    db.commit()
    db.refresh(row)

    submitter_label = f"{current.user.full_name} <{current.user.email}>"
    link = _request_link(org, row.id)
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
    if current.role == Role.USER and not is_approver(current) and row.submitter_id != current.user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
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

    # Only admins may change status. Submitters can edit everything else on their own request.
    if body.status is not None:
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only admins can change status")
        row.status = body.status
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
            current.user.full_name or current.user.email, _request_link(org, row.id),
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
    summary = "\n".join(_summary_lines(row.payload or {}, schema)) or "(no fields filled in)"
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
    )

    row.status = RequestStatus.SUBMITTED
    row.submitted_at = _now()
    if row.first_submitted_at is None:
        row.first_submitted_at = row.submitted_at
    row.submitted_by_id = current.user.id
    row.submission_count = (row.submission_count or 0) + 1
    row.edited_after_submit = False
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
    summary = "\n".join(_summary_lines(row.payload or {}, schema)) or "(no fields filled in)"
    revision = (row.submission_count or 1) + 1
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
    )

    row.submitted_at = _now()
    row.submitted_by_id = current.user.id
    row.submission_count = revision
    row.edited_after_submit = False
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
def export_request_text(request_id: int, bound=Depends(require_org_member), db: Session = Depends(get_db)):
    org, current = bound
    row = _load(db, org.id, request_id)
    if current.role == Role.USER and not is_approver(current) and row.submitter_id != current.user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    submitter = db.get(User, row.submitter_id) if row.submitter_id else None
    schema = _active_schema(db, org.id)
    summary = _summary_lines(row.payload or {}, schema) or ["(no fields filled in)"]
    lines = [
        f"IT Request #{row.id}",
        f"Organization: {org.name} ({org.slug})",
        f"Type: {row.request_type}",
        f"Employee Name: {row.subject}",
        f"Status: {row.status.value}",
        f"Submitted: {row.created_at.isoformat()}",
        f"Submitter: {submitter.full_name + ' <' + submitter.email + '>' if submitter else 'Unknown'}",
        "",
        "--- Summary ---",
        *summary,
    ]
    if row.notes:
        lines += ["", "--- Internal notes (not emailed) ---", row.notes]
    if row.support_message:
        lines += ["", "--- Message to support ---", row.support_message]
    body = "\n".join(lines).encode("utf-8")
    filename = f"request-{row.id}-{datetime.utcnow().strftime('%Y%m%d')}.txt"
    return StreamingResponse(
        io.BytesIO(body),
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
