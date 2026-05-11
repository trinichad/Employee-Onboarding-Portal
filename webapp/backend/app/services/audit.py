from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models import AuditLog, EmployeeRequest, Organization, OrgResource, User


def _resolve_target_label(
    db: Session, target_type: Optional[str], target_id: Optional[Any]
) -> Optional[str]:
    """Look up a human-friendly label for an audit target at write time.

    The label is snapshotted into the audit row's meta so it stays accurate
    even if the target is later deleted (and its primary key reused by an
    unrelated new row).
    """
    if not target_type or target_id is None:
        return None
    try:
        tid = int(target_id)
    except (TypeError, ValueError):
        return None
    if target_type == "user":
        u = db.get(User, tid)
        if u is not None:
            return u.full_name or u.email or None
    elif target_type == "organization":
        o = db.get(Organization, tid)
        if o is not None:
            return o.name or None
    elif target_type == "employee_request":
        r = db.get(EmployeeRequest, tid)
        if r is not None:
            return r.subject or f"Request #{r.id}"
    elif target_type == "org_resource":
        res = db.get(OrgResource, tid)
        if res is not None:
            return getattr(res, "name", None) or None
    return None


def audit(
    db: Session,
    *,
    actor_id: Optional[int],
    action: str,
    organization_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    meta_out: Dict[str, Any] = dict(meta) if meta else {}
    # Snapshot a human-friendly target label so the audit row stays accurate
    # even after the target is deleted. Don't overwrite an explicit caller value.
    if "target_label" not in meta_out:
        label = _resolve_target_label(db, target_type, target_id)
        if label:
            meta_out["target_label"] = label
    db.add(
        AuditLog(
            organization_id=organization_id,
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            meta=meta_out,
        )
    )
