from __future__ import annotations

from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.models import Organization, PlatformSetting
from app.services.email import SmtpConfig, resolve_default_smtp


def _platform(db: Session) -> Optional[PlatformSetting]:
    return db.get(PlatformSetting, 1)


def org_sender(db: Session, org: Optional[Organization]) -> Tuple[str, str]:
    """Return (from_addr, from_name) to use for emails on behalf of this org.

    Resolution order: org-level → platform default → empty (caller falls back to env SMTP_FROM).
    """
    addr = (org.from_email or "").strip() if org else ""
    name = (org.from_name or "").strip() if org else ""
    if not addr or not name:
        ps = _platform(db)
        if ps:
            if not addr:
                addr = (ps.default_from_email or "").strip()
            if not name:
                name = (ps.default_from_name or "").strip()
    return addr, name


def _smtp_from_row(row) -> SmtpConfig:
    return SmtpConfig(
        host=(row.smtp_host or "").strip(),
        port=int(row.smtp_port or 0),
        security=(row.smtp_security or "").strip() or "starttls",
        auth=(row.smtp_auth or "").strip() or "auto",
        username=row.smtp_username or "",
        password=row.smtp_password or "",
    )


def org_smtp(db: Session, org: Optional[Organization]) -> SmtpConfig:
    """Resolve SMTP config: org override → platform DB config → env settings."""
    if org and (org.smtp_host or "").strip():
        return _smtp_from_row(org)
    ps = _platform(db)
    if ps and (ps.smtp_host or "").strip():
        return _smtp_from_row(ps)
    return resolve_default_smtp()
