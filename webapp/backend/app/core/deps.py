from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import Organization, Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


@dataclass
class CurrentUser:
    user: User
    role: Role
    organization_id: Optional[int]


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    if not token:
        raise _unauthorized()
    try:
        payload = decode_access_token(token)
    except ValueError:
        raise _unauthorized("Invalid or expired token")
    if payload.get("type") != "access":
        raise _unauthorized("Wrong token type")
    user_id = int(payload.get("sub", 0))
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise _unauthorized("Account disabled")
    return CurrentUser(user=user, role=user.role, organization_id=user.organization_id)


def require_global_admin(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.role != Role.GLOBAL_ADMIN:
        raise HTTPException(status_code=403, detail="Global admin only")
    return current


def require_client_admin_or_global(current: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current.role not in (Role.GLOBAL_ADMIN, Role.CLIENT_ADMIN):
        raise HTTPException(status_code=403, detail="Admin only")
    return current


def get_org_by_slug(org_slug: str, db: Session = Depends(get_db)) -> Organization:
    org = db.query(Organization).filter(Organization.slug == org_slug).one_or_none()
    if not org or not org.is_active:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def require_org_member(
    org: Organization = Depends(get_org_by_slug),
    current: CurrentUser = Depends(get_current_user),
) -> tuple[Organization, CurrentUser]:
    """Tenant guard. Global admins may access any org; everyone else must match."""
    if current.role == Role.GLOBAL_ADMIN:
        return org, current
    if current.organization_id != org.id:
        raise HTTPException(status_code=403, detail="Forbidden — wrong organization")
    return org, current


def require_org_admin(
    bound: tuple[Organization, CurrentUser] = Depends(require_org_member),
) -> tuple[Organization, CurrentUser]:
    org, current = bound
    if current.role not in (Role.GLOBAL_ADMIN, Role.CLIENT_ADMIN):
        raise HTTPException(status_code=403, detail="Admin role required")
    return org, current


def is_approver(current: CurrentUser) -> bool:
    if current.role in (Role.GLOBAL_ADMIN, Role.CLIENT_ADMIN):
        return True
    return bool(getattr(current.user, "can_approve_requests", False))


def require_org_approver(
    bound: tuple[Organization, CurrentUser] = Depends(require_org_member),
) -> tuple[Organization, CurrentUser]:
    org, current = bound
    if not is_approver(current):
        raise HTTPException(status_code=403, detail="Approver role required")
    return org, current
