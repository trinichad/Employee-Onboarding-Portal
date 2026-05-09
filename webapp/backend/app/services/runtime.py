"""Runtime helpers that read live values from the platform_settings row."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import PlatformSetting


def public_base_url(db: Session) -> str:
    """Return the configured public base URL, with env fallback.

    Reads from `platform_settings.public_base_url` if set, otherwise the
    PUBLIC_BASE_URL env value. Trailing slashes are stripped.
    """
    value: Optional[str] = None
    row = db.get(PlatformSetting, 1)
    if row and (row.public_base_url or "").strip():
        value = row.public_base_url.strip()
    if not value:
        value = settings.PUBLIC_BASE_URL or ""
    return value.rstrip("/")
