"""Two-factor authentication (TOTP) helpers.

Secrets are encrypted at rest with Fernet using a key derived from
``settings.JWT_SECRET`` so changing JWT_SECRET also rotates the key (and
will invalidate existing TOTP secrets — re-enrollment required).
"""
from __future__ import annotations

import base64
import hashlib
import io
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from typing import Tuple

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt

from app.core.config import settings


# ---------- Fernet key (derived from JWT_SECRET) ----------

def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.JWT_SECRET.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Stored TOTP secret is invalid (key rotated?)") from exc


# ---------- TOTP primitives ----------

def new_secret() -> str:
    return pyotp.random_base32()


def verify_code(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    code = code.strip().replace(" ", "")
    if not code.isdigit() or len(code) != 6:
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def provisioning_uri(secret: str, account_name: str, issuer: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=issuer)


def qr_png_base64(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# ---------- Login challenge tokens (short-lived JWT) ----------
#
# When a user passes the password step but still owes a TOTP code (or needs
# to enroll first), the API returns a "challenge" token. The client posts
# that token + the 6-digit code to /auth/totp/verify (or the setup flow)
# to receive real access/refresh tokens.

_CHALLENGE_TTL_MINUTES = 5


def issue_challenge_token(user_id: int, *, kind: str, org_slug: str | None = None) -> str:
    """kind: 'verify' (user is enrolled) | 'setup' (admin must enroll)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "totp_challenge",
        "kind": kind,
        "org": org_slug,
        # Random nonce so two challenges issued the same second differ.
        "nonce": _secrets.token_urlsafe(8),
        "iat": now,
        "exp": now + timedelta(minutes=_CHALLENGE_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_challenge_token(token: str) -> dict:
    try:
        data = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired challenge") from exc
    if data.get("type") != "totp_challenge":
        raise ValueError("Wrong token type")
    return data


# ---------- Policy ----------

def role_requires_totp(role_value: str) -> bool:
    return role_value in ("global_admin", "client_admin")


def needs_totp_enrollment(user) -> bool:
    """Admin-required policy: admin without an active enrollment."""
    return role_requires_totp(user.role.value) and not (user.totp_secret_enc and user.totp_enrolled_at)


def has_totp(user) -> bool:
    return bool(user.totp_secret_enc and user.totp_enrolled_at)


__all__ = [
    "encrypt_secret",
    "decrypt_secret",
    "new_secret",
    "verify_code",
    "provisioning_uri",
    "qr_png_base64",
    "issue_challenge_token",
    "decode_challenge_token",
    "role_requires_totp",
    "needs_totp_enrollment",
    "has_totp",
]
