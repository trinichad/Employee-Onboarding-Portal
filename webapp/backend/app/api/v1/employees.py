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
    row.last_payload = payload
    row.last_submitted_at = req.submitted_at or datetime.now(timezone.utc)
    row.status = EmployeeStatus.TERMINATED.value if _is_termination(req.request_type) else EmployeeStatus.ACTIVE.value
