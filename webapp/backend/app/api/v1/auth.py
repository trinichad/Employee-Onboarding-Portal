from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import CurrentUser, get_current_user
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db
from app.models import InviteToken, Organization, PasswordResetToken, Role, User
from app.schemas import (
    AcceptInvite,
    BootstrapAdminRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    SetupStatus,
    TokenPair,
    UserOut,
)
from app.services.audit import audit
from app.services.runtime import public_base_url
from app.services.email import reset_email
from app.services import totp as totp_svc

router = APIRouter(prefix="/auth", tags=["auth"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _expired(dt: Optional[datetime]) -> bool:
    """Return True if dt is in the past. Treats naive datetimes as UTC so it
    works against values round-tripped through SQLite (which drops tzinfo)."""
    if dt is None:
        return True
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt < _now()


def _issue_tokens(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_access_token(
            user_id=user.id, role=user.role.value, organization_id=user.organization_id
        ),
        refresh_token=create_refresh_token(user_id=user.id),
    )


@router.get("/setup-status", response_model=SetupStatus)
def setup_status(db: Session = Depends(get_db)):
    """Public: tells the UI whether a first-run wizard is needed.

    Returns needs_bootstrap=True only when no Global Admin exists in the DB.
    """
    has_admin = (
        db.query(User.id)
        .filter(User.role == Role.GLOBAL_ADMIN, User.is_active.is_(True))
        .first()
        is not None
    )
    return SetupStatus(needs_bootstrap=not has_admin)


@router.post("/bootstrap")
def bootstrap_admin(body: BootstrapAdminRequest, db: Session = Depends(get_db)):
    """Public, one-shot: create the first Global Admin.

    Hard-fails if any active Global Admin already exists. The endpoint becomes a
    no-op for the rest of the install's life.
    """
    existing = (
        db.query(User.id)
        .filter(User.role == Role.GLOBAL_ADMIN, User.is_active.is_(True))
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Setup already completed")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    email = body.email.lower()
    if db.query(User).filter(User.email == email).one_or_none():
        raise HTTPException(status_code=409, detail="A user with that email already exists")

    user = User(
        email=email,
        full_name=(body.full_name or "Platform Admin"),
        password_hash=hash_password(body.password),
        role=Role.GLOBAL_ADMIN,
        organization_id=None,
        is_active=True,
    )
    db.add(user)
    db.flush()
    audit(db, actor_id=user.id, action="auth.bootstrap_admin", organization_id=None)
    user.last_login_at = _now()
    db.commit()
    db.refresh(user)
    pair = _issue_tokens(user)
    return {"access_token": pair.access_token, "refresh_token": pair.refresh_token, "token_type": pair.token_type}


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    q = db.query(User).filter(User.email == body.email.lower(), User.is_active.is_(True))
    if body.org_slug:
        org = db.query(Organization).filter(Organization.slug == body.org_slug).one_or_none()
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        q = q.filter(User.organization_id == org.id)
    else:
        # Without org_slug only Global Admins may sign in (admin console)
        q = q.filter(User.role == Role.GLOBAL_ADMIN)
    user = q.one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    # 2FA gate
    if totp_svc.has_totp(user):
        return {
            "totp_required": True,
            "challenge": totp_svc.issue_challenge_token(user.id, kind="verify", org_slug=body.org_slug),
        }
    if totp_svc.needs_totp_enrollment(user):
        # Admin without 2FA — must enroll before getting tokens.
        return {
            "totp_setup_required": True,
            "challenge": totp_svc.issue_challenge_token(user.id, kind="setup", org_slug=body.org_slug),
        }
    user.last_login_at = _now()
    audit(db, actor_id=user.id, action="auth.login", organization_id=user.organization_id)
    db.commit()
    pair = _issue_tokens(user)
    return {"access_token": pair.access_token, "refresh_token": pair.refresh_token, "token_type": pair.token_type}


@router.post("/employee-login")
def employee_login(body: LoginRequest, db: Session = Depends(get_db)):
    """Login for organization users without needing the org slug.

    Resolves the organization from the user's account. If multiple active
    organization-scoped accounts exist for the same email, returns 409 with
    the list of organizations so the UI can prompt the user to pick one.
    """
    email = body.email.lower()
    matches = (
        db.query(User)
        .filter(
            User.email == email,
            User.is_active.is_(True),
            User.role != Role.GLOBAL_ADMIN,
            User.organization_id.isnot(None),
        )
        .all()
    )
    if not matches:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if body.org_slug:
        org = db.query(Organization).filter(Organization.slug == body.org_slug).one_or_none()
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        matches = [u for u in matches if u.organization_id == org.id]

    verified = [u for u in matches if u.password_hash and verify_password(body.password, u.password_hash)]
    if not verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if len(verified) > 1:
        orgs = []
        for u in verified:
            org = db.get(Organization, u.organization_id) if u.organization_id else None
            if org:
                orgs.append({"slug": org.slug, "name": org.name})
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"message": "Multiple organizations match this email.", "organizations": orgs},
        )

    user = verified[0]
    # 2FA gate (mirrors /login)
    org = db.get(Organization, user.organization_id) if user.organization_id else None
    org_slug_resolved = org.slug if org else None
    if totp_svc.has_totp(user):
        return {
            "totp_required": True,
            "challenge": totp_svc.issue_challenge_token(user.id, kind="verify", org_slug=org_slug_resolved),
            "organization": {"slug": org.slug, "name": org.name} if org else None,
        }
    if totp_svc.needs_totp_enrollment(user):
        return {
            "totp_setup_required": True,
            "challenge": totp_svc.issue_challenge_token(user.id, kind="setup", org_slug=org_slug_resolved),
            "organization": {"slug": org.slug, "name": org.name} if org else None,
        }
    user.last_login_at = _now()
    audit(db, actor_id=user.id, action="auth.login", organization_id=user.organization_id)
    db.commit()
    tokens = _issue_tokens(user)
    return {
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "token_type": tokens.token_type,
        "organization": {"slug": org.slug, "name": org.name} if org else None,
    }


@router.post("/refresh", response_model=TokenPair)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)) -> TokenPair:
    try:
        payload = decode_refresh_token(body.refresh_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Wrong token type")
    user = db.get(User, int(payload.get("sub", 0)))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Account inactive")
    return _issue_tokens(user)


@router.get("/me", response_model=UserOut)
def me(current: CurrentUser = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current.user)


# ---------- Password reset ----------
@router.post("/password/forgot", status_code=204, response_class=Response)
def password_forgot(body: PasswordResetRequest, db: Session = Depends(get_db)):
    q = db.query(User).filter(User.email == body.email.lower(), User.is_active.is_(True))
    if body.org_slug:
        org = db.query(Organization).filter(Organization.slug == body.org_slug).one_or_none()
        if org:
            q = q.filter(User.organization_id == org.id)
    user = q.one_or_none()
    if user:
        token = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                token=token, user_id=user.id, expires_at=_now() + timedelta(hours=1)
            )
        )
        org_path = ""
        sender_addr = sender_name = ""
        smtp_cfg = None
        if user.organization_id:
            org = db.get(Organization, user.organization_id)
            if org:
                org_path = f"/{org.slug}"
                from app.services.sender import org_sender, org_smtp
                sender_addr, sender_name = org_sender(db, org)
                smtp_cfg = org_smtp(db, org)
        url = f"{public_base_url(db)}{org_path}/reset?token={token}"
        reset_email(user.email, url, from_addr=sender_addr, from_name=sender_name, smtp=smtp_cfg)
        audit(db, actor_id=user.id, action="auth.password_forgot", organization_id=user.organization_id)
        db.commit()
    # Always 204 to avoid email enumeration


@router.post("/password/reset", status_code=204, response_class=Response)
def password_reset(body: PasswordResetConfirm, db: Session = Depends(get_db)):
    row = db.query(PasswordResetToken).filter(PasswordResetToken.token == body.token).one_or_none()
    if not row or row.used_at or _expired(row.expires_at):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    user = db.get(User, row.user_id)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid token")
    user.password_hash = hash_password(body.new_password)
    row.used_at = _now()
    audit(db, actor_id=user.id, action="auth.password_reset", organization_id=user.organization_id)
    db.commit()


# ---------- Invitation acceptance ----------
@router.get("/invite/{token}")
def invite_lookup(token: str, db: Session = Depends(get_db)) -> dict:
    row = db.query(InviteToken).filter(InviteToken.token == token).one_or_none()
    if not row or row.used_at or _expired(row.expires_at):
        raise HTTPException(status_code=400, detail="Invalid or expired invite")
    org = db.get(Organization, row.organization_id) if row.organization_id else None
    return {
        "email": row.email,
        "role": row.role.value,
        "organization": {"slug": org.slug, "name": org.name} if org else None,
    }


@router.post("/invite/accept", response_model=TokenPair)
def invite_accept(body: AcceptInvite, db: Session = Depends(get_db)) -> TokenPair:
    row = db.query(InviteToken).filter(InviteToken.token == body.token).one_or_none()
    if not row or row.used_at or _expired(row.expires_at):
        raise HTTPException(status_code=400, detail="Invalid or expired invite")
    existing = (
        db.query(User)
        .filter(User.email == row.email.lower(), User.organization_id == row.organization_id)
        .one_or_none()
    )
    if existing:
        existing.full_name = body.full_name
        existing.password_hash = hash_password(body.password)
        existing.is_active = True
        user = existing
    else:
        user = User(
            email=row.email.lower(),
            full_name=body.full_name,
            password_hash=hash_password(body.password),
            role=row.role,
            organization_id=row.organization_id,
            is_active=True,
        )
        db.add(user)
        db.flush()
    row.used_at = _now()
    audit(db, actor_id=user.id, action="auth.invite_accept", organization_id=user.organization_id,
          target_type="user", target_id=user.id)
    db.commit()
    return _issue_tokens(user)


# ---------- Two-factor (TOTP) — pre-login challenge endpoints ----------

from app.schemas import TotpEnrollRequest, TotpSetupResponse, TotpVerifyRequest  # noqa: E402


def _resolve_challenge_user(db: Session, token: str, expected_kind: str) -> User:
    try:
        payload = totp_svc.decode_challenge_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if payload.get("kind") != expected_kind:
        raise HTTPException(status_code=400, detail="Wrong challenge type for this step")
    user = db.get(User, int(payload.get("sub", 0)))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Account inactive")
    return user


def _login_response_for(user: User, org_slug: Optional[str]) -> dict:
    pair = _issue_tokens(user)
    org = None
    if user.organization_id:
        org = db_get_org_by_id(user)
    out: dict = {
        "access_token": pair.access_token,
        "refresh_token": pair.refresh_token,
        "token_type": pair.token_type,
    }
    if org_slug or org:
        out["organization"] = {"slug": (org.slug if org else org_slug), "name": (org.name if org else "")}
    return out


def db_get_org_by_id(user: User) -> Optional[Organization]:
    # Helper for type-narrowing; uses the active session via relationship.
    return user.organization


@router.post("/totp/verify")
def totp_verify(body: TotpVerifyRequest, db: Session = Depends(get_db)) -> dict:
    user = _resolve_challenge_user(db, body.challenge, expected_kind="verify")
    if not user.totp_secret_enc:
        raise HTTPException(status_code=400, detail="2FA is not enrolled for this account")
    try:
        secret = totp_svc.decrypt_secret(user.totp_secret_enc)
    except ValueError:
        raise HTTPException(status_code=500, detail="Stored 2FA secret cannot be decrypted; contact an administrator")
    if not totp_svc.verify_code(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid 2FA code")
    user.last_login_at = _now()
    audit(db, actor_id=user.id, action="auth.totp_verify", organization_id=user.organization_id)
    db.commit()
    return _login_response_for(user, org_slug=user.organization.slug if user.organization else None)


@router.post("/totp/setup-from-challenge", response_model=TotpSetupResponse)
def totp_setup_from_challenge(body: dict, db: Session = Depends(get_db)) -> TotpSetupResponse:
    """Generate a pending TOTP secret for an admin completing forced setup."""
    challenge = (body or {}).get("challenge", "")
    user = _resolve_challenge_user(db, challenge, expected_kind="setup")
    secret = totp_svc.new_secret()
    user.totp_pending_secret_enc = totp_svc.encrypt_secret(secret)
    db.commit()
    issuer = "Employee Onboarding Portal"
    account = user.email
    uri = totp_svc.provisioning_uri(secret, account_name=account, issuer=issuer)
    return TotpSetupResponse(
        secret=secret,
        otpauth_url=uri,
        qr_png_base64=totp_svc.qr_png_base64(uri),
        issuer=issuer,
        account=account,
    )


@router.post("/totp/enroll-from-challenge")
def totp_enroll_from_challenge(body: TotpEnrollRequest, db: Session = Depends(get_db)) -> dict:
    if not body.challenge:
        raise HTTPException(status_code=400, detail="Missing challenge")
    user = _resolve_challenge_user(db, body.challenge, expected_kind="setup")
    if not user.totp_pending_secret_enc:
        raise HTTPException(status_code=400, detail="No enrollment in progress — start setup again")
    secret = totp_svc.decrypt_secret(user.totp_pending_secret_enc)
    if not totp_svc.verify_code(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid 2FA code — try again")
    user.totp_secret_enc = user.totp_pending_secret_enc
    user.totp_pending_secret_enc = None
    user.totp_enrolled_at = _now()
    user.last_login_at = _now()
    audit(db, actor_id=user.id, action="auth.totp_enroll", organization_id=user.organization_id)
    db.commit()
    return _login_response_for(user, org_slug=user.organization.slug if user.organization else None)
