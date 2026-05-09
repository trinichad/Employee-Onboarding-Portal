from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_user
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.schemas import (
    ChangePassword,
    ProfileUpdate,
    TotpDisableRequest,
    TotpEnrollRequest,
    TotpReEnrollRequest,
    TotpSetupResponse,
    UserOut,
)
from app.services import totp as totp_svc
from app.services.audit import audit

router = APIRouter(prefix="/me", tags=["me"])


@router.patch("", response_model=UserOut)
def update_profile(
    body: ProfileUpdate,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> UserOut:
    if body.full_name is not None:
        current.user.full_name = body.full_name
    if body.theme is not None:
        current.user.theme = body.theme
    audit(db, actor_id=current.user.id, action="profile.update", organization_id=current.organization_id,
          target_type="user", target_id=current.user.id)
    db.commit()
    db.refresh(current.user)
    return UserOut.model_validate(current.user)


@router.post("/password", status_code=204, response_class=Response)
def change_password(
    body: ChangePassword,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    if not current.user.password_hash or not verify_password(body.current_password, current.user.password_hash):
        raise HTTPException(status_code=400, detail="Current password incorrect")
    current.user.password_hash = hash_password(body.new_password)
    audit(db, actor_id=current.user.id, action="profile.password_change",
          organization_id=current.organization_id)
    db.commit()


# ---------- Two-factor (TOTP) self-service ----------

def _begin_setup(user, *, issuer: str) -> TotpSetupResponse:
    secret = totp_svc.new_secret()
    user.totp_pending_secret_enc = totp_svc.encrypt_secret(secret)
    uri = totp_svc.provisioning_uri(secret, account_name=user.email, issuer=issuer)
    return TotpSetupResponse(
        secret=secret,
        otpauth_url=uri,
        qr_png_base64=totp_svc.qr_png_base64(uri),
        issuer=issuer,
        account=user.email,
    )


@router.post("/totp/setup", response_model=TotpSetupResponse)
def totp_setup(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TotpSetupResponse:
    """Begin enrollment for an account with no active 2FA.

    For users who already have 2FA enrolled (e.g. lost device), use
    ``POST /me/totp/reenroll`` which requires the current password first.
    """
    user = current.user
    if totp_svc.has_totp(user):
        raise HTTPException(
            status_code=400,
            detail="2FA is already enrolled. Use 'Reset 2FA' to register a new device — your password is required.",
        )
    resp = _begin_setup(user, issuer="Employee Onboarding Portal")
    db.commit()
    return resp


@router.post("/totp/reenroll", response_model=TotpSetupResponse)
def totp_reenroll(
    body: TotpReEnrollRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> TotpSetupResponse:
    """Begin a fresh enrollment when 2FA is already active (new device).

    Requires the user's current password as a knowledge factor before we
    overwrite the existing secret. The active secret is preserved until the
    new code is confirmed via ``POST /me/totp/enroll``.
    """
    user = current.user
    if not user.password_hash or not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password incorrect")
    resp = _begin_setup(user, issuer="Employee Onboarding Portal")
    audit(db, actor_id=user.id, action="profile.totp_reenroll_begin", organization_id=current.organization_id)
    db.commit()
    return resp


@router.post("/totp/enroll", response_model=UserOut)
def totp_enroll(
    body: TotpEnrollRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> UserOut:
    """Confirm the in-progress enrollment with a code from the new authenticator."""
    user = current.user
    if not user.totp_pending_secret_enc:
        raise HTTPException(status_code=400, detail="No enrollment in progress — start setup first")
    secret = totp_svc.decrypt_secret(user.totp_pending_secret_enc)
    if not totp_svc.verify_code(secret, body.code):
        raise HTTPException(status_code=401, detail="Invalid 2FA code — try again")
    user.totp_secret_enc = user.totp_pending_secret_enc
    user.totp_pending_secret_enc = None
    from datetime import datetime, timezone
    user.totp_enrolled_at = datetime.now(timezone.utc)
    audit(db, actor_id=user.id, action="profile.totp_enroll", organization_id=current.organization_id)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/totp/cancel-setup", status_code=204, response_class=Response)
def totp_cancel_setup(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    """Discard a pending (un-confirmed) enrollment without affecting the active secret."""
    current.user.totp_pending_secret_enc = None
    db.commit()


@router.post("/totp/disable", response_model=UserOut)
def totp_disable(
    body: TotpDisableRequest,
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
) -> UserOut:
    """Remove 2FA entirely. Forbidden for roles where 2FA is mandatory."""
    user = current.user
    if totp_svc.role_requires_totp(user.role.value):
        raise HTTPException(
            status_code=403,
            detail="Two-factor authentication is required for administrators and cannot be disabled. Use 'Reset on new device' instead.",
        )
    if not user.password_hash or not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password incorrect")
    if user.totp_secret_enc and body.code:
        # Optional belt-and-suspenders: verify a code from the active authenticator.
        try:
            secret = totp_svc.decrypt_secret(user.totp_secret_enc)
        except ValueError:
            secret = ""
        if secret and not totp_svc.verify_code(secret, body.code):
            raise HTTPException(status_code=401, detail="Invalid 2FA code")
    user.totp_secret_enc = None
    user.totp_pending_secret_enc = None
    user.totp_enrolled_at = None
    audit(db, actor_id=user.id, action="profile.totp_disable", organization_id=current.organization_id)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)
