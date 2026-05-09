from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import require_org_admin, require_org_member
from app.db.session import get_db
from app.models import FormSchema
from app.schemas import FormSchemaIn, FormSchemaOut
from app.services.audit import audit

router = APIRouter(prefix="/orgs/{org_slug}/form", tags=["forms"])


@router.get("", response_model=FormSchemaOut)
def get_active_form(bound=Depends(require_org_member), db: Session = Depends(get_db)) -> FormSchemaOut:
    org, _ = bound
    row = (
        db.query(FormSchema)
        .filter(FormSchema.organization_id == org.id, FormSchema.is_active.is_(True))
        .order_by(FormSchema.version.desc())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="No active form schema for this organization")
    return FormSchemaOut.model_validate(row)


@router.put("", response_model=FormSchemaOut)
def update_form(
    body: FormSchemaIn,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> FormSchemaOut:
    org, current = bound
    # Deactivate previous, create a new version
    prev = (
        db.query(FormSchema)
        .filter(FormSchema.organization_id == org.id, FormSchema.is_active.is_(True))
        .order_by(FormSchema.version.desc())
        .first()
    )
    next_version = (prev.version + 1) if prev else 1
    if prev:
        prev.is_active = False
    new_row = FormSchema(
        organization_id=org.id, version=next_version, is_active=True,
        schema=body.schema, created_by_id=current.user.id,
    )
    db.add(new_row)
    audit(db, actor_id=current.user.id, action="form.update", organization_id=org.id,
          target_type="form_schema", target_id=str(next_version))
    db.commit()
    db.refresh(new_row)
    return FormSchemaOut.model_validate(new_row)
