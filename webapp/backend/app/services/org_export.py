"""Per-organization export / import.

Serializes an entire organization (settings, users, form schemas, resources,
employee directory, requests, logo) to a portable JSON document and re-creates
it on import. IDs are remapped so a document can be imported on the same
platform under a different slug or on a different platform entirely.

Excluded by design:
  - Audit logs (referenced across orgs, can be large; backup the DB to keep)
  - Invite / password-reset tokens (transient)
"""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from slugify import slugify
from sqlalchemy.orm import Session

from app.models import (
    Employee,
    EmployeeRequest,
    FormSchema,
    OrgResource,
    Organization,
    RequestStatus,
    Role,
    User,
)
from app.services.branding import find_logo, logos_dir

EXPORT_VERSION = 1


# --------------------------------------------------------------------------- #
# Export                                                                       #
# --------------------------------------------------------------------------- #

def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _logo_payload(stem: str, ext: str) -> Optional[dict]:
    if not ext:
        return None
    found = find_logo(stem, ext)
    if not found:
        return None
    path, _mime = found
    try:
        data = Path(path).read_bytes()
    except OSError:
        return None
    return {"ext": ext, "data_b64": base64.b64encode(data).decode("ascii")}


def export_organization(db: Session, org: Organization) -> dict:
    """Return a JSON-serializable dict describing ``org`` and all its children."""
    users = db.query(User).filter(User.organization_id == org.id).all()
    user_email_to_idx: dict[str, int] = {u.email: i for i, u in enumerate(users)}

    # Form schemas (ordered by version for determinism).
    forms = (
        db.query(FormSchema)
        .filter(FormSchema.organization_id == org.id)
        .order_by(FormSchema.version.asc())
        .all()
    )

    # Resources + reverse-id map for serializing cross-resource links by key.
    resources = (
        db.query(OrgResource)
        .filter(OrgResource.organization_id == org.id)
        .order_by(OrgResource.kind, OrgResource.name)
        .all()
    )
    resource_by_id = {r.id: r for r in resources}

    # Requests (ordered by id so the array index is a stable foreign key).
    requests = (
        db.query(EmployeeRequest)
        .filter(EmployeeRequest.organization_id == org.id)
        .order_by(EmployeeRequest.id.asc())
        .all()
    )
    request_id_to_idx: dict[int, int] = {r.id: i for i, r in enumerate(requests)}

    employees = (
        db.query(Employee)
        .filter(Employee.organization_id == org.id)
        .order_by(Employee.id.asc())
        .all()
    )

    def _user_email(uid: Optional[int]) -> Optional[str]:
        if uid is None:
            return None
        u = next((x for x in users if x.id == uid), None)
        return u.email if u else None

    return {
        "slug": org.slug,
        "name": org.name,
        "is_active": bool(org.is_active),
        "branding": dict(org.branding or {}),
        "support_email": org.support_email or "",
        "from_email": org.from_email or "",
        "from_name": org.from_name or "",
        "dashboard_columns": list(org.dashboard_columns) if org.dashboard_columns else None,
        "smtp": {
            "host": org.smtp_host or "",
            "port": int(org.smtp_port or 0),
            "security": org.smtp_security or "",
            "auth": org.smtp_auth or "",
            "username": org.smtp_username or "",
            "password": org.smtp_password or "",
        },
        "logo": _logo_payload(f"org-{org.id}", org.logo_ext or ""),
        "users": [
            {
                "email": u.email,
                "full_name": u.full_name or "",
                "role": u.role.value if isinstance(u.role, Role) else str(u.role),
                "can_approve_requests": bool(u.can_approve_requests),
                "is_active": bool(u.is_active),
                "password_hash": u.password_hash or None,
                "totp_secret_enc": u.totp_secret_enc or None,
                "totp_pending_secret_enc": u.totp_pending_secret_enc or None,
                "totp_enrolled_at": _iso(u.totp_enrolled_at),
                "theme": u.theme or "light",
                "last_login_at": _iso(u.last_login_at),
                "created_at": _iso(u.created_at),
            }
            for u in users
        ],
        "form_schemas": [
            {
                "version": int(f.version),
                "is_active": bool(f.is_active),
                "schema": f.schema or {},
                "created_by_email": _user_email(f.created_by_id),
                "created_at": _iso(f.created_at),
            }
            for f in forms
        ],
        "resources": [
            {
                "kind": r.kind,
                "name": r.name,
                "attributes": dict(r.attributes or {}),
                "is_active": bool(r.is_active),
                "linked_keys": [
                    {"kind": resource_by_id[rid].kind, "name": resource_by_id[rid].name}
                    for rid in (r.linked_resource_ids or [])
                    if rid in resource_by_id
                ],
                "created_at": _iso(r.created_at),
            }
            for r in resources
        ],
        "requests": [
            {
                "request_type": r.request_type,
                "subject": r.subject or "",
                "status": r.status.value if isinstance(r.status, RequestStatus) else str(r.status),
                "payload": r.payload or {},
                "notes": r.notes or None,
                "support_message": r.support_message or None,
                "edited_after_submit": bool(r.edited_after_submit),
                "submission_count": int(r.submission_count or 0),
                "submitter_email": _user_email(r.submitter_id),
                "approved_by_email": _user_email(r.approved_by_id),
                "submitted_by_email": _user_email(r.submitted_by_id),
                "approved_at": _iso(r.approved_at),
                "submitted_at": _iso(r.submitted_at),
                "first_submitted_at": _iso(r.first_submitted_at),
                "created_at": _iso(r.created_at),
            }
            for r in requests
        ],
        "employees": [
            {
                "full_name": e.full_name or "",
                "email": e.email or "",
                "status": e.status,
                "last_request_type": e.last_request_type or "",
                "last_payload": e.last_payload or {},
                "last_submitted_at": _iso(e.last_submitted_at),
                "last_request_idx": request_id_to_idx.get(e.last_request_id) if e.last_request_id else None,
                "created_at": _iso(e.created_at),
            }
            for e in employees
        ],
    }


def export_payload(db: Session, orgs: list[Organization]) -> dict:
    """Wrap one or more org exports in a versioned envelope."""
    return {
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "organizations": [export_organization(db, o) for o in orgs],
    }


# --------------------------------------------------------------------------- #
# Import                                                                       #
# --------------------------------------------------------------------------- #

def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _coerce_status(value: Any) -> RequestStatus:
    try:
        return RequestStatus(value)
    except (TypeError, ValueError):
        return RequestStatus.PENDING_APPROVAL


def _coerce_role(value: Any) -> Role:
    try:
        return Role(value)
    except (TypeError, ValueError):
        return Role.USER


def _save_logo_b64(stem: str, payload: dict) -> str:
    """Persist a base64 logo payload to disk and return its extension."""
    ext = str(payload.get("ext") or "").strip().lower()
    data_b64 = payload.get("data_b64") or ""
    if not ext or not data_b64:
        return ""
    try:
        data = base64.b64decode(data_b64)
    except (ValueError, TypeError):
        return ""
    d = logos_dir()
    # Remove any prior logo for this stem.
    for old in d.glob(f"{stem}.*"):
        try:
            old.unlink()
        except OSError:
            pass
    (d / f"{stem}.{ext}").write_bytes(data)
    return ext


def import_organization(
    db: Session,
    payload: dict,
    *,
    slug_override: Optional[str] = None,
    name_override: Optional[str] = None,
) -> tuple[Organization, dict]:
    """Re-create an organization from an ``export_organization`` payload.

    Raises ValueError if the resulting slug already exists. The new
    organization (with all children) is added to the session but NOT
    committed; the caller is responsible for the transaction boundary.

    Returns ``(organization, stats)``.
    """
    raw_slug = (slug_override or payload.get("slug") or payload.get("name") or "").strip()
    slug = slugify(raw_slug)
    if not slug:
        raise ValueError("Organization slug is required")
    if db.query(Organization).filter(Organization.slug == slug).first():
        raise ValueError(f"Slug '{slug}' is already in use")

    name = (name_override or payload.get("name") or slug).strip()
    smtp = payload.get("smtp") or {}
    branding = payload.get("branding") or {}
    dashboard_columns = payload.get("dashboard_columns")

    org = Organization(
        slug=slug,
        name=name,
        is_active=bool(payload.get("is_active", True)),
        branding=branding if isinstance(branding, dict) else {},
        support_email=str(payload.get("support_email") or ""),
        from_email=str(payload.get("from_email") or ""),
        from_name=str(payload.get("from_name") or ""),
        dashboard_columns=list(dashboard_columns) if dashboard_columns else None,
        smtp_host=str(smtp.get("host") or ""),
        smtp_port=int(smtp.get("port") or 0),
        smtp_security=str(smtp.get("security") or ""),
        smtp_auth=str(smtp.get("auth") or ""),
        smtp_username=str(smtp.get("username") or ""),
        smtp_password=str(smtp.get("password") or ""),
    )
    db.add(org)
    db.flush()  # need org.id for FKs and logo file naming

    # --- Logo ---
    logo = payload.get("logo")
    if isinstance(logo, dict):
        try:
            ext = _save_logo_b64(f"org-{org.id}", logo)
            if ext:
                org.logo_ext = ext
        except OSError:
            pass

    # --- Users ---
    user_by_email: dict[str, User] = {}
    for u in payload.get("users") or []:
        email = str(u.get("email") or "").strip().lower()
        if not email:
            continue
        if email in user_by_email:
            continue
        row = User(
            organization_id=org.id,
            email=email,
            full_name=str(u.get("full_name") or ""),
            password_hash=u.get("password_hash") or None,
            role=_coerce_role(u.get("role")),
            can_approve_requests=bool(u.get("can_approve_requests")),
            is_active=bool(u.get("is_active", True)),
            totp_secret_enc=u.get("totp_secret_enc") or None,
            totp_pending_secret_enc=u.get("totp_pending_secret_enc") or None,
            totp_enrolled_at=_parse_dt(u.get("totp_enrolled_at")),
            theme=str(u.get("theme") or "light"),
            last_login_at=_parse_dt(u.get("last_login_at")),
        )
        # Non-global-admins must belong to an org; guard against bad data.
        if row.role == Role.GLOBAL_ADMIN:
            row.role = Role.CLIENT_ADMIN
        db.add(row)
        user_by_email[email] = row
    db.flush()

    # --- Form schemas ---
    for f in payload.get("form_schemas") or []:
        created_by_email = (f.get("created_by_email") or "").strip().lower()
        creator = user_by_email.get(created_by_email)
        row = FormSchema(
            organization_id=org.id,
            version=int(f.get("version") or 1),
            is_active=bool(f.get("is_active")),
            schema=f.get("schema") or {},
            created_by_id=creator.id if creator else None,
        )
        db.add(row)
    db.flush()

    # --- Resources (two passes: create, then link) ---
    res_by_key: dict[tuple[str, str], OrgResource] = {}
    resource_inputs = payload.get("resources") or []
    for r in resource_inputs:
        kind = str(r.get("kind") or "").strip()
        name_r = str(r.get("name") or "").strip()
        if not kind or not name_r:
            continue
        row = OrgResource(
            organization_id=org.id,
            kind=kind,
            name=name_r,
            attributes=dict(r.get("attributes") or {}),
            linked_resource_ids=[],
            is_active=bool(r.get("is_active", True)),
        )
        db.add(row)
        res_by_key[(kind, name_r.lower())] = row
    db.flush()
    for r in resource_inputs:
        kind = str(r.get("kind") or "").strip()
        name_r = str(r.get("name") or "").strip()
        if not kind or not name_r:
            continue
        target = res_by_key.get((kind, name_r.lower()))
        if not target:
            continue
        ids: list[int] = []
        for k in r.get("linked_keys") or []:
            lk_kind = str(k.get("kind") or "").strip()
            lk_name = str(k.get("name") or "").strip().lower()
            link = res_by_key.get((lk_kind, lk_name))
            if link is not None:
                ids.append(link.id)
        if ids:
            target.linked_resource_ids = ids

    # --- Requests (track by export-index so employees can reference them) ---
    request_by_idx: dict[int, EmployeeRequest] = {}
    for idx, r in enumerate(payload.get("requests") or []):
        submitter = user_by_email.get((r.get("submitter_email") or "").strip().lower())
        approver = user_by_email.get((r.get("approved_by_email") or "").strip().lower())
        submitted_by = user_by_email.get((r.get("submitted_by_email") or "").strip().lower())
        row = EmployeeRequest(
            organization_id=org.id,
            submitter_id=submitter.id if submitter else None,
            request_type=str(r.get("request_type") or ""),
            subject=str(r.get("subject") or ""),
            status=_coerce_status(r.get("status")),
            approved_by_id=approver.id if approver else None,
            approved_at=_parse_dt(r.get("approved_at")),
            submitted_at=_parse_dt(r.get("submitted_at")),
            first_submitted_at=_parse_dt(r.get("first_submitted_at")),
            submitted_by_id=submitted_by.id if submitted_by else None,
            payload=r.get("payload") or {},
            notes=r.get("notes"),
            support_message=r.get("support_message"),
            edited_after_submit=bool(r.get("edited_after_submit")),
            submission_count=int(r.get("submission_count") or 0),
        )
        db.add(row)
        request_by_idx[idx] = row
    db.flush()

    # --- Employees (resolve last_request_idx back to a new request id) ---
    for e in payload.get("employees") or []:
        last_idx = e.get("last_request_idx")
        last_req = request_by_idx.get(last_idx) if isinstance(last_idx, int) else None
        row = Employee(
            organization_id=org.id,
            full_name=str(e.get("full_name") or ""),
            email=str(e.get("email") or ""),
            status=str(e.get("status") or "active"),
            last_request_id=last_req.id if last_req else None,
            last_request_type=str(e.get("last_request_type") or ""),
            last_payload=e.get("last_payload") or {},
            last_submitted_at=_parse_dt(e.get("last_submitted_at")),
        )
        db.add(row)
    db.flush()

    stats = {
        "slug": org.slug,
        "name": org.name,
        "users": len(user_by_email),
        "form_schemas": len(payload.get("form_schemas") or []),
        "resources": len(res_by_key),
        "requests": len(request_by_idx),
        "employees": len(payload.get("employees") or []),
        "logo": bool(org.logo_ext),
    }
    return org, stats
