"""Per-org employee directory + service helpers used by Promotion / Termination
/ Rehire flows. The renderer uses GET /orgs/{slug}/employees?q=... to typeahead
and prefill the form from the employee's most recent submitted request.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import require_org_admin, require_org_member
from app.db.session import get_db
from app.models import Employee, EmployeeRequest, EmployeeStatus, Organization
from app.schemas import EmployeeOut

router = APIRouter(prefix="/orgs/{org_slug}/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeOut])
def search_employees(
    q: str = Query(default="", max_length=200),
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
) -> list[EmployeeOut]:
    org, _ = bound
    query = db.query(Employee).filter(Employee.organization_id == org.id)
    if status:
        query = query.filter(Employee.status == status)
    if q:
        like = f"%{q.lower()}%"
        query = query.filter(or_(
            Employee.full_name.ilike(like),
            Employee.email.ilike(like),
        ))
    rows = (
        query.order_by(Employee.last_submitted_at.desc().nullslast(), Employee.full_name)
        .limit(limit)
        .all()
    )
    return [EmployeeOut.model_validate(r) for r in rows]


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: int,
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
) -> EmployeeOut:
    org, _ = bound
    row = db.get(Employee, employee_id)
    if not row or row.organization_id != org.id:
        raise HTTPException(status_code=404, detail="Employee not found")
    return EmployeeOut.model_validate(row)


@router.delete("/{employee_id}", status_code=204)
def delete_employee(
    employee_id: int,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    org, _ = bound
    row = db.get(Employee, employee_id)
    if not row or row.organization_id != org.id:
        raise HTTPException(status_code=404, detail="Employee not found")
    db.delete(row)
    db.commit()


# ---- service helper used by requests.submit ----
TERMINATION_TYPE_HINTS = ("termination", "terminate", "offboard", "off-boarding", "departure")


def _is_termination(request_type: str) -> bool:
    rt = (request_type or "").lower()
    return any(h in rt for h in TERMINATION_TYPE_HINTS)


def _effective_payload(payload: dict) -> dict:
    """Return a copy of `payload` with items the submitter marked
    `[REMOVE PREVIOUS ACCESS]` / `[REMOVE]` actually pruned from the form
    state, and the transient `_prior_*` metadata stripped.

    The on-form payload keeps removed items checked (so reviewers see what
    used to be granted next to the REMOVE pill in the summary/PDF). But the
    Employee.last_payload row represents the employee's *effective* access
    going forward — the next change request's "previous access" snapshot
    must not re-surface items that were already revoked. This pruning is
    what makes the prior-access workflow idempotent across requests.
    """
    import copy

    if not isinstance(payload, dict) or not payload:
        return payload or {}
    acts = payload.get("_prior_actions") or {}
    act_fields: dict = acts.get("fields") or {}
    act_groups: dict = acts.get("groups") or {}
    out = copy.deepcopy(payload)

    # Drop tracked fields the submitter chose to remove.
    for fid, action in act_fields.items():
        if action == "remove":
            out.pop(fid, None)

    # Drop tracked group items the submitter chose to remove. Group payload
    # may be either the plain {itemId: bool} shape (static groups) or the
    # {default: {…}, extras: [{resource_id, items}]} shape (dynamic groups).
    groups_val = out.get("_groups")
    if isinstance(groups_val, dict):
        for gid, ctxs in act_groups.items():
            if not isinstance(ctxs, dict):
                continue
            raw = groups_val.get(gid)
            if not isinstance(raw, dict):
                continue
            is_dynamic = "default" in raw or "extras" in raw
            for ctx_key, items in ctxs.items():
                if not isinstance(items, dict):
                    continue
                remove_ids = [iid for iid, a in items.items() if a == "remove"]
                if not remove_ids:
                    continue
                if not is_dynamic:
                    # Static group: ctx_key is always "default".
                    for iid in remove_ids:
                        raw.pop(iid, None)
                    continue
                if ctx_key == "default":
                    default_sel = raw.get("default") or {}
                    for iid in remove_ids:
                        default_sel.pop(iid, None)
                    raw["default"] = default_sel
                elif ctx_key.startswith("extra:"):
                    try:
                        rid = int(ctx_key.split(":", 1)[1])
                    except ValueError:
                        continue
                    extras = raw.get("extras") or []
                    new_extras = []
                    for ex in extras:
                        if not isinstance(ex, dict):
                            new_extras.append(ex)
                            continue
                        if ex.get("resource_id") == rid:
                            ex_items = dict(ex.get("items") or {})
                            for iid in remove_ids:
                                ex_items.pop(iid, None)
                            if ex_items:
                                new_extras.append({**ex, "items": ex_items})
                            # else: drop the now-empty extras card entirely
                        else:
                            new_extras.append(ex)
                    raw["extras"] = new_extras

    # Strip the prior-* metadata so the next request rebuilds a fresh
    # snapshot from the pruned effective payload.
    out.pop("_prior_snapshot", None)
    out.pop("_prior_actions", None)
    return out


def upsert_from_request(db: Session, org: Organization, req: EmployeeRequest, schema: dict | None) -> None:
    """Upsert the org's Employee row for `req` using its payload.

    Uses the form schema to figure out which fields hold the employee identity
    (fields with role == 'employee_name' / 'employee_email'). Falls back to a
    handful of common keys (full_name, name, employee_name, email).

    If the request_type looks like a termination, marks the employee terminated.
    """
    payload = req.payload or {}
    name_keys: list[str] = []
    email_keys: list[str] = []
    for f in (schema or {}).get("fields", []) or []:
        role = (f.get("role") or "").strip()
        if role == "employee_name" and f.get("id"):
            name_keys.append(f["id"])
        elif role == "employee_email" and f.get("id"):
            email_keys.append(f["id"])
    name_keys.extend(["employee_name", "full_name", "name"])
    email_keys.extend(["employee_email", "email", "work_email"])

    def _first(keys: list[str]) -> str:
        for k in keys:
            v = payload.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""

    name = _first(name_keys)
    email = _first(email_keys).lower()
    if not name and not email:
        return  # nothing to upsert

    row: Optional[Employee] = None
    if email:
        row = (
            db.query(Employee)
            .filter(Employee.organization_id == org.id, Employee.email == email)
            .one_or_none()
        )
    if row is None and name:
        row = (
            db.query(Employee)
            .filter(Employee.organization_id == org.id, Employee.full_name == name, Employee.email == "")
            .one_or_none()
        )
    if row is None:
        row = Employee(organization_id=org.id, full_name=name, email=email)
        db.add(row)

    if name:
        row.full_name = name
    if email:
        row.email = email
    row.last_request_id = req.id
    row.last_request_type = req.request_type or ""
    row.last_payload = _effective_payload(payload)
    row.last_submitted_at = req.submitted_at or datetime.now(timezone.utc)
    row.status = EmployeeStatus.TERMINATED.value if _is_termination(req.request_type) else EmployeeStatus.ACTIVE.value
