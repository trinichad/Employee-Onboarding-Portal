"""Per-org resource catalog (properties, shared mailboxes, network folders,
distribution groups, google drives, licenses, etc.) used by the form builder.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.deps import require_org_admin, require_org_member
from app.db.session import get_db
from app.models import OrgResource
from app.schemas import OrgResourceIn, OrgResourceOut, OrgResourceUpdate, RESOURCE_KINDS
from app.services.audit import audit

router = APIRouter(prefix="/orgs/{org_slug}/resources", tags=["resources"])


@router.get("", response_model=list[OrgResourceOut])
def list_resources(
    kind: str | None = Query(default=None),
    include_inactive: bool = Query(default=False),
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
) -> list[OrgResourceOut]:
    org, _ = bound
    q = db.query(OrgResource).filter(OrgResource.organization_id == org.id)
    if not include_inactive:
        q = q.filter(OrgResource.is_active.is_(True))
    if kind:
        if kind not in RESOURCE_KINDS:
            raise HTTPException(status_code=400, detail="Unsupported kind")
        q = q.filter(OrgResource.kind == kind)
    rows = q.order_by(OrgResource.kind, OrgResource.name).all()
    return [OrgResourceOut.model_validate(r) for r in rows]


@router.post("", response_model=OrgResourceOut, status_code=201)
def create_resource(
    body: OrgResourceIn,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> OrgResourceOut:
    org, current = bound
    row = OrgResource(
        organization_id=org.id,
        kind=body.kind,
        name=body.name.strip(),
        attributes=body.attributes or {},
        linked_resource_ids=list(body.linked_resource_ids or []),
        is_active=body.is_active,
    )
    db.add(row)
    db.flush()
    audit(db, actor_id=current.user.id, action="resource.create", organization_id=org.id,
          target_type="org_resource", target_id=row.id, meta={"kind": row.kind, "name": row.name})
    db.commit()
    db.refresh(row)
    return OrgResourceOut.model_validate(row)


@router.patch("/{resource_id}", response_model=OrgResourceOut)
def update_resource(
    resource_id: int,
    body: OrgResourceUpdate,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> OrgResourceOut:
    org, current = bound
    row = db.get(OrgResource, resource_id)
    if not row or row.organization_id != org.id:
        raise HTTPException(status_code=404, detail="Resource not found")
    if body.name is not None:
        row.name = body.name.strip()
    if body.attributes is not None:
        row.attributes = body.attributes
    if body.linked_resource_ids is not None:
        row.linked_resource_ids = list(body.linked_resource_ids)
    if body.is_active is not None:
        row.is_active = bool(body.is_active)
    audit(db, actor_id=current.user.id, action="resource.update", organization_id=org.id,
          target_type="org_resource", target_id=row.id)
    db.commit()
    db.refresh(row)
    return OrgResourceOut.model_validate(row)


@router.delete("/{resource_id}", status_code=204, response_class=Response)
def delete_resource(
    resource_id: int,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    org, current = bound
    row = db.get(OrgResource, resource_id)
    if not row or row.organization_id != org.id:
        raise HTTPException(status_code=404, detail="Resource not found")
    db.delete(row)
    audit(db, actor_id=current.user.id, action="resource.delete", organization_id=org.id,
          target_type="org_resource", target_id=resource_id)
    db.commit()
