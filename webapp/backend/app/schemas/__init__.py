from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models import Role, RequestStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    @model_validator(mode="after")
    def _utc_tag_naive_datetimes(self) -> "ORMModel":
        """SQLite drops tzinfo on `DateTime(timezone=True)` columns, so naive
        datetimes coming from the DB are actually UTC. Tag them so JSON
        output includes the offset and the browser parses correctly."""
        for name, value in list(self.__dict__.items()):
            if isinstance(value, datetime) and value.tzinfo is None:
                object.__setattr__(self, name, value.replace(tzinfo=timezone.utc))
        return self


# ---------- Auth ----------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    org_slug: Optional[str] = None  # required for non-global-admin login flows


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class BootstrapAdminRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class SetupStatus(BaseModel):
    needs_bootstrap: bool


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr
    org_slug: Optional[str] = None


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class AcceptInvite(BaseModel):
    token: str
    full_name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


# ---------- Organization ----------
class OrganizationCreate(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: Optional[str] = Field(default=None, max_length=64)
    seed_default_form: bool = True
    branding: Dict[str, Any] = Field(default_factory=dict)


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    branding: Optional[Dict[str, Any]] = None
    support_email: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    dashboard_columns: Optional[List[str]] = None


class OrganizationOut(ORMModel):
    id: int
    slug: str
    name: str
    is_active: bool
    branding: Dict[str, Any]
    support_email: str = ""
    from_email: str = ""
    from_name: str = ""
    dashboard_columns: Optional[List[str]] = None
    created_at: datetime


class OrganizationDelete(BaseModel):
    confirm_name: str  # must equal organization.name


# ---------- Users ----------
class UserCreateInvite(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    role: Role = Role.USER
    can_approve_requests: bool = False


class AdminInviteUser(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    role: Role
    organization_id: Optional[int] = None


class AdminSetPassword(BaseModel):
    new_password: str = Field(min_length=8, max_length=200)


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    is_active: Optional[bool] = None
    role: Optional[Role] = None
    can_approve_requests: Optional[bool] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    theme: Optional[str] = Field(default=None, pattern="^(light|dark|system)$")


class UserOut(ORMModel):
    id: int
    email: str
    full_name: str
    role: Role
    can_approve_requests: bool = False
    is_active: bool
    organization_id: Optional[int]
    last_login_at: Optional[datetime]
    created_at: datetime
    totp_enrolled: bool = False
    theme: str = "light"

    @model_validator(mode="after")
    def _derive_totp_enrolled(self) -> "UserOut":
        # Set in api layer via from_user(); this default keeps schema valid.
        return self


# ---------- TOTP / 2FA ----------
class TotpVerifyRequest(BaseModel):
    challenge: str
    code: str = Field(min_length=6, max_length=8)


class TotpEnrollRequest(BaseModel):
    """Confirms an in-progress enrollment with a code from the new authenticator.

    During the forced first-time admin setup, ``challenge`` carries the user
    identity (no session yet). For self-service enrollment from a profile
    page the request is authenticated and ``challenge`` should be omitted.
    """
    code: str = Field(min_length=6, max_length=8)
    challenge: Optional[str] = None


class TotpDisableRequest(BaseModel):
    current_password: str
    code: Optional[str] = Field(default=None, min_length=6, max_length=8)


class TotpReEnrollRequest(BaseModel):
    """Begin a new enrollment when one is already active (e.g. lost device).

    Requires the current password — the user is logged in but we still want
    a knowledge factor before letting them swap the second factor.
    """
    current_password: str


class TotpSetupResponse(BaseModel):
    secret: str
    otpauth_url: str
    qr_png_base64: str
    issuer: str
    account: str


# ---------- Form Schema ----------
class FormSchemaIn(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    schema: Dict[str, Any]


class FormSchemaOut(ORMModel):
    id: int
    organization_id: int
    version: int
    is_active: bool
    schema: Dict[str, Any]
    created_at: datetime


# ---------- Employee Requests ----------
class EmployeeRequestCreate(BaseModel):
    request_type: str = Field(min_length=1, max_length=120)
    subject: str = Field(default="", max_length=255)
    payload: Dict[str, Any]


class EmployeeRequestUpdate(BaseModel):
    status: Optional[RequestStatus] = None
    subject: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None
    notes: Optional[str] = None
    support_message: Optional[str] = None


class EmployeeRequestOut(ORMModel):
    id: int
    organization_id: int
    submitter_id: Optional[int]
    request_type: str
    subject: str
    status: RequestStatus
    payload: Dict[str, Any]
    notes: Optional[str]
    support_message: Optional[str] = None
    approved_by_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    submitted_by_id: Optional[int] = None
    submitted_at: Optional[datetime] = None
    first_submitted_at: Optional[datetime] = None
    edited_after_submit: bool = False
    submission_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---------- Audit ----------
class AuditOut(ORMModel):
    id: int
    organization_id: Optional[int]
    actor_id: Optional[int]
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    action: str
    target_type: Optional[str]
    target_id: Optional[str]
    meta: Dict[str, Any]
    created_at: datetime


# ---------- Platform settings ----------
class SmtpConfigOut(BaseModel):
    smtp_host: str = ""
    smtp_port: int = 0
    smtp_security: str = ""  # ""|none|starttls|ssl
    smtp_auth: str = ""      # ""|none|auto|plain|login|cram_md5
    smtp_username: str = ""
    smtp_password_set: bool = False


class SmtpConfigUpdate(BaseModel):
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = Field(default=None, ge=0, le=65535)
    smtp_security: Optional[str] = None
    smtp_auth: Optional[str] = None
    smtp_username: Optional[str] = None
    # password: None = unchanged; "" = clear; any other value = set
    smtp_password: Optional[str] = None


class PlatformSettingsOut(SmtpConfigOut):
    platform_name: str
    default_support_email: str
    default_from_email: str = ""
    default_from_name: str = ""
    default_dashboard_columns: Optional[List[str]] = None
    timezone: str = "UTC"
    smtp_configured: bool = False  # True if a usable host is configured (DB or env)
    smtp_from: str = ""             # env SMTP_FROM (legacy/fallback)
    public_base_url: str = ""
    backend_port: int = 8000
    runtime_env_path: str = ""
    runtime_env_writable: bool = False


class PlatformSettingsUpdate(SmtpConfigUpdate):
    platform_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    default_support_email: Optional[str] = None
    default_from_email: Optional[str] = None
    default_from_name: Optional[str] = None
    default_dashboard_columns: Optional[List[str]] = None
    timezone: Optional[str] = Field(default=None, max_length=64)
    public_base_url: Optional[str] = Field(default=None, max_length=512)
    backend_port: Optional[int] = Field(default=None, ge=1, le=65535)


class OrganizationSmtpOut(SmtpConfigOut):
    organization_id: int


class OrganizationSmtpUpdate(SmtpConfigUpdate):
    pass


# ---------- Resource catalog ----------
RESOURCE_KINDS = (
    "property",
    "shared_mailbox",
    "network_folder",
    "distribution_group",
    "google_drive",
    "license",
    "email",
    "other",
)


import re as _kind_re
_KIND_RE = _kind_re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")


class OrgResourceIn(BaseModel):
    kind: str = Field(..., max_length=40)
    name: str = Field(..., min_length=1, max_length=255)
    attributes: Dict[str, Any] = Field(default_factory=dict)
    linked_resource_ids: List[int] = Field(default_factory=list)
    is_active: bool = True

    @model_validator(mode="after")
    def _validate_kind(self) -> "OrgResourceIn":
        if not _KIND_RE.match(self.kind or ""):
            raise ValueError("kind must be a slug (a-z0-9_-, max 40)")
        return self


class OrgResourceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    attributes: Optional[Dict[str, Any]] = None
    linked_resource_ids: Optional[List[int]] = None
    is_active: Optional[bool] = None


class OrgResourceOut(ORMModel):
    id: int
    organization_id: int
    kind: str
    name: str
    attributes: Dict[str, Any] = Field(default_factory=dict)
    linked_resource_ids: List[int] = Field(default_factory=list)
    is_active: bool
    updated_at: Optional[datetime] = None


class OrgResourceBulkRow(BaseModel):
    """One row in a bulk import. action defaults to upsert."""
    action: str = Field(default="upsert")  # upsert | add | update | delete
    kind: str
    name: str = Field(..., min_length=1, max_length=255)
    attributes: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def _validate(self) -> "OrgResourceBulkRow":
        if self.action not in ("upsert", "add", "update", "delete"):
            raise ValueError(f"Unsupported action: {self.action}")
        if not _KIND_RE.match(self.kind or ""):
            raise ValueError("kind must be a slug (a-z0-9_-, max 40)")
        return self


class OrgResourceBulkIn(BaseModel):
    rows: List[OrgResourceBulkRow]


class OrgResourceBulkResultRow(BaseModel):
    row: int
    action: str
    kind: str
    name: str
    result: str  # created | updated | deleted | skipped | error
    detail: Optional[str] = None
    id: Optional[int] = None


class OrgResourceBulkOut(BaseModel):
    created: int = 0
    updated: int = 0
    deleted: int = 0
    skipped: int = 0
    errors: int = 0
    rows: List[OrgResourceBulkResultRow] = Field(default_factory=list)


# ---------- Employee directory ----------
class EmployeeOut(ORMModel):
    id: int
    organization_id: int
    full_name: str
    email: str
    status: str
    last_request_id: Optional[int] = None
    last_request_type: str
    last_payload: Dict[str, Any] = Field(default_factory=dict)
    last_submitted_at: Optional[datetime] = None

