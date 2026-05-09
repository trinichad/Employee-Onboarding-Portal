from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(password, hashed)
    except Exception:
        return False


def _encode(payload: Dict[str, Any], secret: str, ttl: timedelta) -> str:
    now = datetime.now(timezone.utc)
    to_encode = {**payload, "iat": now, "exp": now + ttl}
    return jwt.encode(to_encode, secret, algorithm=settings.JWT_ALGORITHM)


def create_access_token(*, user_id: int, role: str, organization_id: Optional[int]) -> str:
    return _encode(
        {"sub": str(user_id), "role": role, "org": organization_id, "type": "access"},
        settings.JWT_SECRET,
        timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES),
    )


def create_refresh_token(*, user_id: int) -> str:
    return _encode(
        {"sub": str(user_id), "type": "refresh"},
        settings.JWT_REFRESH_SECRET,
        timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS),
    )


def decode_access_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("invalid token") from exc


def decode_refresh_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_REFRESH_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("invalid token") from exc
