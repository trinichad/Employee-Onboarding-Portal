export type Role = "global_admin" | "client_admin" | "user";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  can_approve_requests?: boolean;
  is_active: boolean;
  organization_id: number | null;
  organization_slug?: string | null;
  last_login_at: string | null;
  created_at: string;
  totp_enrolled?: boolean;
  has_password?: boolean;
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
  logo_url?: string | null;
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
  /** Request types where the renderer surfaces a "previous access review"
   *  panel: every field and group item flagged with `prior_access_tracked`
   *  that was filled in by the employee's last submission can be tagged
   *  Keep / Remove so reviewers know what to revoke. */
  prior_access_request_types?: string[];
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
  /** When true and the current request type is in
   *  `FormSchemaDoc.prior_access_request_types`, this field participates in
   *  the previous-access review panel (Keep / Remove pill rendered next to
   *  the value when it matches the snapshot from the employee's prior
   *  submission). */
  prior_access_tracked?: boolean;
}
export interface FormGroup {
  id: string;
  title: string;
  enabled: boolean;
  /** When true and the current request type is in
   *  `FormSchemaDoc.prior_access_request_types`, items in this group that
   *  were checked in the employee's prior submission render a Keep / Remove
   *  pill in the renderer. */
  prior_access_tracked?: boolean;
  items: {
    id: string;
    label: string;
    description?: string;
    /** Auto-check this checkbox based on a truthy attribute on the resource
     *  selected in `source_field_id`. The attribute value is read from
     *  `resource.attributes[attribute]` and treated as truthy/falsy
     *  ("yes"/"true"/"1"/"x" → checked; "no"/"false"/"0"/empty → unchecked).
     *  Defaults reapply when the source value changes; the user is free to
     *  toggle afterwards.
     *
     *  In dynamic (per-resource) groups, `source_field_id` is ignored — the
     *  attribute is read from each rendered instance's own resource. Defaults
     *  are applied the moment the instance's placeholder becomes populated
     *  (default context: when the source field is first set; extra contexts:
     *  when the extra is added via the picker) and whenever that instance's
     *  resource is swapped for a different one. */
    auto_check_from?: { source_field_id: string; attribute: string };
  }[];
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
  /** Conditionally show this group based on an attribute of a selected
   *  resource.
   *
   *  - For non-dynamic groups, `source_field_id` names the resource field to
   *    inspect. The group renders only if the named resource's
   *    `attributes[attribute]` satisfies the condition.
   *  - For dynamic groups, the condition is evaluated per rendered instance
   *    using THAT instance's resource (source_field_id is ignored). An
   *    instance whose resource does not satisfy the condition is skipped.
   *
   *  Condition semantics (combine as needed):
   *    truthy: true   → attribute must be truthy ("yes"/"true"/"1"/"x"/non-empty)
   *    equals: "..."  → attribute must equal the given value (or one of them)
   *  Set `negate: true` to invert the check (i.e. "hide when ...").
   *  When unset, the group is always visible. */
  visible_when?: {
    source_field_id?: string;
    attribute: string;
    equals?: string | string[];
    truthy?: boolean;
    negate?: boolean;
    /** Dynamic groups only: when the primary (default) resource fails the
     *  rule, normally the whole card is hidden. Setting this keeps the
     *  "+ Add another …" picker visible (filtered to resources that pass
     *  the rule) so users can still add eligible instances even when the
     *  primary selection is excluded. */
    keep_picker?: boolean;
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
  target_label?: string | null;
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
  logo_url?: string | null;
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
