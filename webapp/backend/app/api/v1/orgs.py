from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import require_org_admin, require_org_member
from app.db.session import get_db
from app.models import Organization
from app.schemas import OrganizationOut, OrganizationUpdate
from app.services.audit import audit

router = APIRouter(prefix="/orgs", tags=["organizations"])


@router.get("/{org_slug}", response_model=OrganizationOut)
def get_org(bound=Depends(require_org_member)) -> OrganizationOut:
    org: Organization = bound[0]
    return OrganizationOut.model_validate(org)


@router.patch("/{org_slug}/settings", response_model=OrganizationOut)
def update_org_settings(
    body: OrganizationUpdate,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> OrganizationOut:
    org, current = bound
    # Org admins can edit support email, dashboard columns, branding, and name.
    if body.name is not None:
        org.name = body.name.strip()
    if body.branding is not None:
        org.branding = body.branding
    if body.support_email is not None:
        org.support_email = body.support_email.strip()
    if body.from_email is not None:
        org.from_email = body.from_email.strip()
    if body.from_name is not None:
        org.from_name = body.from_name.strip()
    if body.dashboard_columns is not None:
        org.dashboard_columns = list(body.dashboard_columns)
    audit(db, actor_id=current.user.id, action="org.settings_update", organization_id=org.id,
          target_type="organization", target_id=org.id)
    db.commit()
    db.refresh(org)
    return OrganizationOut.model_validate(org)
