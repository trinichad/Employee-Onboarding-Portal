from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum
from typing import List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class Role(str, PyEnum):
    GLOBAL_ADMIN = "global_admin"
    CLIENT_ADMIN = "client_admin"
    USER = "user"


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    branding: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    support_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    from_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    from_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # Per-org SMTP override (global-admin only). Empty smtp_host falls back to platform/env.
    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    smtp_security: Mapped[str] = mapped_column(String(20), nullable=False, default="")  # none|starttls|ssl
    smtp_auth: Mapped[str] = mapped_column(String(20), nullable=False, default="")      # none|auto|plain|login|cram_md5
    smtp_username: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_password: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    dashboard_columns: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    users: Mapped[List["User"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    forms: Mapped[List["FormSchema"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    requests: Mapped[List["EmployeeRequest"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan"
    )


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("organization_id", "email", name="uq_user_org_email"),
        Index("ix_users_email_lower", func.lower("email")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="role"), nullable=False, default=Role.USER)
    can_approve_requests: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Two-factor authentication (TOTP). Secrets are stored Fernet-encrypted.
    # totp_secret_enc != None AND totp_enrolled_at != None => 2FA active.
    # totp_pending_secret_enc holds an in-progress enrollment until the user
    # confirms the first 6-digit code; clearing it cancels the setup.
    totp_secret_enc: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    totp_pending_secret_enc: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    totp_enrolled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # UI preference: 'light' | 'dark' | 'system' (default).
    theme: Mapped[str] = mapped_column(String(16), nullable=False, default="light")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    organization: Mapped[Optional[Organization]] = relationship(back_populates="users")

    @property
    def totp_enrolled(self) -> bool:  # consumed by Pydantic UserOut
        return bool(self.totp_secret_enc and self.totp_enrolled_at)


class FormSchema(Base):
    """Versioned per-organization form configuration. The latest `is_active=True` row is rendered."""

    __tablename__ = "form_schemas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    schema: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    organization: Mapped[Organization] = relationship(back_populates="forms")


class RequestStatus(str, PyEnum):
    PENDING_APPROVAL = "pending_approval"
    PENDING_SUBMITTAL = "pending_submittal"
    SUBMITTED = "submitted"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    REJECTED = "rejected"
    CANCELED = "canceled"


class EmployeeRequest(Base):
    __tablename__ = "employee_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    submitter_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    request_type: Mapped[str] = mapped_column(String(120), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, name="request_status", create_constraint=False, native_enum=False),
        default=RequestStatus.PENDING_APPROVAL,
        nullable=False,
    )
    approved_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    first_submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    support_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # True when the request was edited after being sent to support and has
    # not yet been resent. Cleared by the resubmit endpoint.
    edited_after_submit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Number of times this request has been emailed to support (initial + resubmissions).
    submission_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    organization: Mapped[Organization] = relationship(back_populates="requests")


class InviteToken(Base):
    __tablename__ = "invite_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    organization_id: Mapped[Optional[int]] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    role: Mapped[Role] = mapped_column(Enum(Role, name="role"), nullable=False)
    invited_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    target_type: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    target_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PlatformSetting(Base):
    """Singleton row (id=1) holding global platform configuration."""

    __tablename__ = "platform_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    platform_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Employee Onboarding Portal")
    default_support_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    default_from_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    default_from_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    default_dashboard_columns: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=None)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    # Platform-wide SMTP relay config. Empty smtp_host falls back to env settings.
    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    smtp_security: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    smtp_auth: Mapped[str] = mapped_column(String(20), nullable=False, default="")
    smtp_username: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    smtp_password: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
