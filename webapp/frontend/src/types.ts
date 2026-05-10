export type Role = "global_admin" | "client_admin" | "user";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  can_approve_requests?: boolean;
  is_active: boolean;
  organization_id: number | null;
  last_login_at: string | null;
  created_at: string;
  totp_enrolled?: boolean;
  theme?: "light" | "dark" | "system";
}

export interface Organization {
  id: number;
  slug: string;
  name: string;
  is_active: boolean;
  branding: Record<string, any>;
  support_email?: string;
  from_email?: string;
  from_name?: string;
  dashboard_columns?: string[] | null;
  created_at: string;
}

export interface FormSchemaDoc {
  form_name?: string;
  request_types?: string[];
  fields?: FormField[];
  groups?: FormGroup[];
  /** Request types that should show the employee typeahead/prefill UI. */
  lookup_request_types?: string[];
  /** Request types that should mark the employee as terminated and surface
   *  the forwarding / mailbox-grant fields in the renderer. */
  termination_request_types?: string[];
}
export type ResourceKind = string;
export type FieldRole =
  | "" | "employee_name" | "employee_email"
  | "forward_email_to" | "grant_full_access_to";
export interface FormField {
  id: string;
  label: string;
  description?: string;
  type: "text" | "date" | "textarea" | "email" | "number" | "select" | "resource";
  required?: boolean;
  options?: string[];
  /** For type === "resource": which catalog kind to pull options from. */
  resource_kind?: ResourceKind;
  /** When set, populate this field from another (resource) field's chosen
   *  resource. `attribute` may be "name" or any key under attributes. */
  auto_from?: { source_field_id: string; attribute: string };
  /** For resource fields: limit options to those linked to the resource
   *  selected in `source_field_id`. */
  filter_by?: { source_field_id: string };
  /** Optional semantic role used by the renderer for special behaviors. */
  role?: FieldRole;
  /** When set, only render this field if the current request_type is in this list. */
  visible_when_request_type_in?: string[];
}
export interface FormGroup {
  id: string;
  title: string;
  enabled: boolean;
  items: { id: string; label: string; description?: string }[];
  /** When set, this group is rendered once per "context resource". The group
   *  title and item labels may contain a placeholder (default "{Property}")
   *  which is substituted with the context resource's name. The default
   *  context comes from the field whose id is `source_field_id`. If
   *  `allow_additional` is true, the user can add more contexts by picking
   *  additional resources (of `resource_kind`, or the source field's kind).
   *  Selections are stored under values._groups[groupId] as
   *    { default: {itemId: bool}, extras: [{ resource_id, items }] } */
  dynamic?: {
    source_field_id: string;
    placeholder?: string;
    allow_additional?: boolean;
    additional_button_label?: string;
    resource_kind?: string;
  };
}
export interface FormSchemaResp {
  id: number;
  organization_id: number;
  version: number;
  is_active: boolean;
  schema: FormSchemaDoc;
  created_at: string;
}

export type RequestStatus =
  | "pending_approval"
  | "pending_submittal"
  | "submitted"
  | "in_progress"
  | "completed"
  | "rejected"
  | "canceled";
export interface EmployeeRequest {
  id: number;
  organization_id: number;
  submitter_id: number | null;
  request_type: string;
  subject: string;
  status: RequestStatus;
  payload: Record<string, any>;
  notes?: string | null;
  support_message?: string | null;
  approved_by_id?: number | null;
  approved_at?: string | null;
  submitted_by_id?: number | null;
  submitted_at?: string | null;
  first_submitted_at?: string | null;
  edited_after_submit?: boolean;
  submission_count?: number;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: number;
  organization_id: number | null;
  actor_id: number | null;
  actor_email?: string | null;
  actor_name?: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, any>;
  created_at: string;
}

export interface SmtpConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_security: string;   // "" | "none" | "starttls" | "ssl"
  smtp_auth: string;       // "" | "none" | "auto" | "plain" | "login" | "cram_md5"
  smtp_username: string;
  smtp_password_set: boolean;
}

export interface OrganizationSmtp extends SmtpConfig {
  organization_id: number;
}

export interface PlatformSettings extends SmtpConfig {
  platform_name: string;
  default_support_email: string;
  default_from_email: string;
  default_from_name: string;
  default_dashboard_columns?: string[] | null;
  timezone: string;
  smtp_configured: boolean;
  smtp_from: string;
  public_base_url: string;
  backend_port: number;
  runtime_env_path: string;
  runtime_env_writable: boolean;
}

export interface SmtpConfigUpdate {
  smtp_host?: string;
  smtp_port?: number;
  smtp_security?: string;
  smtp_auth?: string;
  smtp_username?: string;
  smtp_password?: string; // omit = unchanged, "" = clear, value = set
}

// ---- Two-factor (TOTP)
export type TokenPair = { access_token: string; refresh_token: string; token_type?: string };

export type LoginResponse =
  | (TokenPair & { totp_required?: undefined; totp_setup_required?: undefined })
  | { totp_required: true; challenge: string }
  | { totp_setup_required: true; challenge: string };

export type EmployeeLoginResponse =
  | (TokenPair & { organization: { slug: string; name: string } | null; totp_required?: undefined; totp_setup_required?: undefined })
  | { totp_required: true; challenge: string; organization: { slug: string; name: string } | null }
  | { totp_setup_required: true; challenge: string; organization: { slug: string; name: string } | null };

export interface TotpSetupData {
  secret: string;
  otpauth_url: string;
  qr_png_base64: string;
  issuer: string;
  account: string;
}

export interface OrgResource {
  id: number;
  organization_id: number;
  kind: ResourceKind;
  name: string;
  attributes: Record<string, any>;
  linked_resource_ids: number[];
  is_active: boolean;
  updated_at?: string;
}

export interface Employee {
  id: number;
  organization_id: number;
  full_name: string;
  email: string;
  status: "active" | "terminated";
  last_request_id?: number | null;
  last_request_type: string;
  last_payload: Record<string, any>;
  last_submitted_at?: string | null;
}
