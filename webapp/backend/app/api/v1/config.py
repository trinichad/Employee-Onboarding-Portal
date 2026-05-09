from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import PlatformSetting

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def public_config(db: Session = Depends(get_db)) -> dict:
    """Public, unauthenticated platform metadata used by the frontend to
    render localized timestamps and the app title before login."""
    row = db.get(PlatformSetting, 1)
    return {
        "platform_name": (row.platform_name if row else "Employee Onboarding Portal") or "Employee Onboarding Portal",
        "timezone": (row.timezone if row else "UTC") or "UTC",
    }
