"""Per-org resource catalog (properties, shared mailboxes, network folders,
distribution groups, google drives, licenses, etc.) used by the form builder.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.deps import require_org_admin, require_org_member
from app.db.session import get_db
from app.models import OrgResource
from app.schemas import (
    OrgResourceIn,
    OrgResourceOut,
    OrgResourceUpdate,
    OrgResourceBulkIn,
    OrgResourceBulkOut,
    OrgResourceBulkResultRow,
    RESOURCE_KINDS,
)
from app.services.audit import audit

router = APIRouter(prefix="/orgs/{org_slug}/resources", tags=["resources"])


@router.get("", response_model=list[OrgResourceOut])
def list_resources(
    kind: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    bound=Depends(require_org_member),
    db: Session = Depends(get_db),
) -> list[OrgResourceOut]:
    org, _ = bound
    q = db.query(OrgResource).filter(OrgResource.organization_id == org.id)
    if not include_inactive:
        q = q.filter(OrgResource.is_active.is_(True))
    if kind:
        if not kind.replace("_", "").replace("-", "").isalnum():
            raise HTTPException(status_code=400, detail="Invalid kind")
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


@router.post("/bulk", response_model=OrgResourceBulkOut)
def bulk_resources(
    body: OrgResourceBulkIn,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> OrgResourceBulkOut:
    """Bulk create/update/delete resources.

    Match key for update/delete is (kind, name) within the org. Action 'upsert'
    creates if no match, otherwise updates. 'add' always creates (errors on
    duplicate). 'update' errors if no match. 'delete' errors if no match.
    Attributes from the row are merged into the existing row's attributes
    (set keys to empty string to clear).
    """
    org, current = bound
    out = OrgResourceBulkOut()

    # Pre-fetch existing rows for fast lookup.
    existing = db.query(OrgResource).filter(OrgResource.organization_id == org.id).all()
    by_key: dict[tuple[str, str], OrgResource] = {(r.kind, r.name.lower()): r for r in existing}

    for i, row in enumerate(body.rows, start=1):
        key = (row.kind, row.name.strip().lower())
        cur = by_key.get(key)
        action = row.action

        try:
            if action == "delete":
                if not cur:
                    out.skipped += 1
                    out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="skipped", detail="not found"))
                    continue
                rid = cur.id
                db.delete(cur)
                by_key.pop(key, None)
                audit(db, actor_id=current.user.id, action="resource.delete", organization_id=org.id,
                      target_type="org_resource", target_id=rid, meta={"via": "bulk"})
                out.deleted += 1
                out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="deleted", id=rid))
                continue

            if action == "add" and cur:
                out.errors += 1
                out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="error", detail="already exists"))
                continue

            if action == "update" and not cur:
                out.errors += 1
                out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="error", detail="not found"))
                continue

            if cur is None:
                # create
                cur = OrgResource(
                    organization_id=org.id,
                    kind=row.kind,
                    name=row.name.strip(),
                    attributes=dict(row.attributes or {}),
                    linked_resource_ids=[],
                    is_active=row.is_active if row.is_active is not None else True,
                )
                db.add(cur)
                db.flush()
                by_key[key] = cur
                audit(db, actor_id=current.user.id, action="resource.create", organization_id=org.id,
                      target_type="org_resource", target_id=cur.id, meta={"via": "bulk", "kind": cur.kind, "name": cur.name})
                out.created += 1
                out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="created", id=cur.id))
            else:
                # update: merge attributes (empty string clears a key)
                if row.attributes is not None:
                    merged = dict(cur.attributes or {})
                    for k, v in row.attributes.items():
                        if v == "":
                            merged.pop(k, None)
                        else:
                            merged[k] = v
                    cur.attributes = merged
                if row.is_active is not None:
                    cur.is_active = bool(row.is_active)
                audit(db, actor_id=current.user.id, action="resource.update", organization_id=org.id,
                      target_type="org_resource", target_id=cur.id, meta={"via": "bulk"})
                out.updated += 1
                out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="updated", id=cur.id))
        except Exception as e:  # noqa: BLE001
            out.errors += 1
            out.rows.append(OrgResourceBulkResultRow(row=i, action=action, kind=row.kind, name=row.name, result="error", detail=str(e)[:200]))

    db.commit()
    return out
