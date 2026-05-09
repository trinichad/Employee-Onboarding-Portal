from __future__ import annotations

from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models import AuditLog


def audit(
    db: Session,
    *,
    actor_id: Optional[int],
    action: str,
    organization_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    db.add(
        AuditLog(
            organization_id=organization_id,
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            meta=meta or {},
        )
    )
