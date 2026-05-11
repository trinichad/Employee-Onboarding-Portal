from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import require_org_admin, require_org_member
from app.db.session import get_db
from app.models import InviteToken, PasswordResetToken, Role, User
from app.schemas import UserCreateInvite, UserOut, UserUpdate
from app.services.audit import audit
from app.services.email import invite_email, reset_email
from app.services.sender import org_sender, org_smtp

router = APIRouter(prefix="/orgs/{org_slug}/users", tags=["users"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("", response_model=List[UserOut])
def list_users(bound=Depends(require_org_member), db: Session = Depends(get_db)) -> List[UserOut]:
    org, _ = bound
    rows = db.query(User).filter(User.organization_id == org.id).order_by(User.created_at.desc()).all()
    return [UserOut.model_validate(u) for u in rows]


@router.post("", response_model=UserOut, status_code=201)
def invite_user(
    body: UserCreateInvite,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    org, current = bound
    if body.role == Role.CLIENT_ADMIN and current.role != Role.GLOBAL_ADMIN:
        raise HTTPException(status_code=403, detail="Only Global Admins can create Client Admins")
    if body.role == Role.GLOBAL_ADMIN:
        raise HTTPException(status_code=400, detail="Global admins cannot belong to an organization")
    email = body.email.lower()
    if db.query(User).filter(User.organization_id == org.id, User.email == email).first():
        raise HTTPException(status_code=409, detail="User already exists in this organization")
    user = User(
        email=email, full_name=body.full_name, role=body.role,
        organization_id=org.id, is_active=True, password_hash=None,
        can_approve_requests=bool(body.can_approve_requests),
    )
    db.add(user)
    db.flush()
    token = secrets.token_urlsafe(32)
    db.add(InviteToken(
        token=token, email=email, organization_id=org.id, role=body.role,
        invited_by_id=current.user.id, expires_at=_now() + timedelta(days=7),
    ))
    addr, name = org_sender(db, org)
    from app.services.runtime import public_base_url
    invite_email(email, org.name,
                 f"{public_base_url(db)}/{org.slug}/accept?token={token}",
                 from_addr=addr, from_name=name, smtp=org_smtp(db, org))
    audit(db, actor_id=current.user.id, action="user.invite", organization_id=org.id,
          target_type="user", target_id=user.id, meta={"role": body.role.value})
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    bound=Depends(require_org_admin),
    db: Session = Depends(get_db),
) -> UserOut:
    org, current = bound
    user = db.get(User, user_id)
    if not user or user.organization_id != org.id:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role is not None:
        if body.role == Role.GLOBAL_ADMIN:
            raise HTTPException(status_code=400, detail="Cannot promote to Global Admin within an org")
        if body.role == Role.CLIENT_ADMIN and current.role != Role.GLOBAL_ADMIN:
            raise HTTPException(status_code=403, detail="Only Global Admins can promote Client Admins")
        user.role = body.role
    if body.full_name is not None:
        user.full_name = body.full_name
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.can_approve_requests is not None:
        user.can_approve_requests = bool(body.can_approve_requests)
    audit(db, actor_id=current.user.id, action="user.update", organization_id=org.id,
          target_type="user", target_id=user.id)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.delete("/{user_id}", status_code=204, response_class=Response)
def delete_user(user_id: int, bound=Depends(require_org_admin), db: Session = Depends(get_db)):
    org, current = bound
    user = db.get(User, user_id)
    if not user or user.organization_id != org.id:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current.user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db.delete(user)
    audit(db, actor_id=current.user.id, action="user.delete", organization_id=org.id,
          target_type="user", target_id=user_id)
    db.commit()


@router.post("/{user_id}/reset-password", status_code=204, response_class=Response)
def reset_user_password(user_id: int, bound=Depends(require_org_admin), db: Session = Depends(get_db)):
    org, current = bound
    user = db.get(User, user_id)
    if not user or user.organization_id != org.id:
        raise HTTPException(status_code=404, detail="User not found")
    token = secrets.token_urlsafe(32)
    db.add(PasswordResetToken(token=token, user_id=user.id, expires_at=_now() + timedelta(hours=2)))
    addr, name = org_sender(db, org)
    from app.services.runtime import public_base_url
    reset_email(user.email,
                f"{public_base_url(db)}/{org.slug}/reset?token={token}",
                from_addr=addr, from_name=name, smtp=org_smtp(db, org))
    audit(db, actor_id=current.user.id, action="user.force_password_reset", organization_id=org.id,
          target_type="user", target_id=user.id)
    db.commit()


@router.post("/{user_id}/resend-invite", status_code=204, response_class=Response)
def resend_invite(user_id: int, bound=Depends(require_org_admin), db: Session = Depends(get_db)):
    """Re-issue an invite to a user in this org who hasn't completed setup yet."""
    org, current = bound
    user = db.get(User, user_id)
    if not user or user.organization_id != org.id:
        raise HTTPException(status_code=404, detail="User not found")
    if user.password_hash:
        raise HTTPException(status_code=400, detail="User has already completed account setup")

    now = _now()
    pending = (
        db.query(InviteToken)
        .filter(
            InviteToken.email == user.email,
            InviteToken.organization_id == org.id,
            InviteToken.used_at.is_(None),
        )
        .all()
    )
    for tok in pending:
        tok.used_at = now

    token = secrets.token_urlsafe(32)
    db.add(InviteToken(
        token=token, email=user.email, organization_id=org.id, role=user.role,
        invited_by_id=current.user.id, expires_at=now + timedelta(days=7),
    ))
    addr, name = org_sender(db, org)
    from app.services.runtime import public_base_url
    try:
        invite_email(user.email, org.name,
                     f"{public_base_url(db)}/{org.slug}/accept?token={token}",
                     from_addr=addr, from_name=name, smtp=org_smtp(db, org),
                     raise_on_error=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=(
                f"Invite email could not be delivered: {exc}. "
                "Verify SMTP and From address in Settings, then try again."
            ),
        )
    audit(db, actor_id=current.user.id, action="user.resend_invite", organization_id=org.id,
          target_type="user", target_id=user.id)
    db.commit()
