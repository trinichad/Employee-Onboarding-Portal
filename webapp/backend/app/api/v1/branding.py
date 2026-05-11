"""Public + admin endpoints for serving and managing logo assets.

All read endpoints are unauthenticated so the favicon and login screen can
load them. Write endpoints require global-admin (platform logo + any org) or
org-admin (their own org).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, require_global_admin, require_org_admin
from app.db.session import get_db
from app.models import Organization, PlatformSetting
from app.services import branding as branding_svc
from app.services.audit import audit

router = APIRouter(prefix="/branding", tags=["branding"])


# --------- Public read endpoints ---------------------------------------------
@router.get("/platform/logo", include_in_schema=False)
def get_platform_logo(db: Session = Depends(get_db)):
    row = db.get(PlatformSetting, 1)
    ext = (row.logo_ext if row else "") or ""
    found = branding_svc.find_logo("platform", ext)
    if not found:
        raise HTTPException(status_code=404, detail="No platform logo set")
    path, mime = found
    return FileResponse(str(path), media_type=mime)


@router.get("/orgs/{slug}/logo", include_in_schema=False)
def get_org_logo(slug: str, db: Session = Depends(get_db)):
    org = db.query(Organization).filter(Organization.slug == slug).one_or_none()
    if not org or not org.logo_ext:
        raise HTTPException(status_code=404, detail="No organization logo set")
    found = branding_svc.find_logo(f"org-{org.id}", org.logo_ext)
    if not found:
        raise HTTPException(status_code=404, detail="No organization logo set")
    path, mime = found
    return FileResponse(str(path), media_type=mime)


# --------- Admin write endpoints ---------------------------------------------
def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return (file.content_type or ""), data


@router.put("/platform/logo", status_code=204, response_class=Response)
def upload_platform_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_global_admin),
):
    content_type, data = _read_upload(file)
    row = db.get(PlatformSetting, 1)
    if not row:
        row = PlatformSetting(id=1)
        db.add(row)
        db.flush()
    try:
        ext = branding_svc.save_logo("platform", content_type, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    row.logo_ext = ext
    audit(db, actor_id=current.user.id, action="platform.logo_upload",
          target_type="platform_settings", target_id=row.id)
    db.commit()


@router.delete("/platform/logo", status_code=204, response_class=Response)
def delete_platform_logo(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(require_global_admin),
):
    row = db.get(PlatformSetting, 1)
    branding_svc.delete_logo("platform")
    if row:
        row.logo_ext = ""
    audit(db, actor_id=current.user.id, action="platform.logo_delete",
          target_type="platform_settings", target_id=(row.id if row else None))
    db.commit()


@router.put("/orgs/{org_slug}/logo", status_code=204, response_class=Response)
def upload_org_logo(
    file: UploadFile = File(...),
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    org, current = bound
    content_type, data = _read_upload(file)
    try:
        ext = branding_svc.save_logo(f"org-{org.id}", content_type, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    org.logo_ext = ext
    audit(db, actor_id=current.user.id, action="org.logo_upload",
          organization_id=org.id, target_type="organization", target_id=org.id)
    db.commit()


@router.delete("/orgs/{org_slug}/logo", status_code=204, response_class=Response)
def delete_org_logo(
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
):
    org, current = bound
    branding_svc.delete_logo(f"org-{org.id}")
    org.logo_ext = ""
    audit(db, actor_id=current.user.id, action="org.logo_delete",
          organization_id=org.id, target_type="organization", target_id=org.id)
    db.commit()
