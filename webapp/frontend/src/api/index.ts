import { api } from "./client";
import type {
  AuditEntry,
  Employee,
  EmployeeLoginResponse,
  EmployeeRequest,
  FormSchemaDoc,
  FormSchemaResp,
  LoginResponse,
  Organization,
  OrganizationSmtp,
  OrgResource,
  PlatformSettings,
  RequestStatus,
  ResourceKind,
  Role,
  SmtpConfigUpdate,
  TokenPair,
  TotpSetupData,
  User,
} from "@/types";

// ---- auth
export const authApi = {
  setupStatus: () =>
    api.get<{ needs_bootstrap: boolean }>("/auth/setup-status").then(r => r.data),
  bootstrap: (email: string, password: string, full_name?: string) =>
    api.post<TokenPair>("/auth/bootstrap", { email, password, full_name }).then(r => r.data),
  login: (email: string, password: string, org_slug?: string) =>
    api.post<LoginResponse>("/auth/login", { email, password, org_slug }).then(r => r.data),
  employeeLogin: (email: string, password: string, org_slug?: string) =>
    api.post<EmployeeLoginResponse>("/auth/employee-login", { email, password, org_slug }).then(r => r.data),
  me: () => api.get<User>("/auth/me").then(r => r.data),
  forgot: (email: string, org_slug?: string) =>
    api.post("/auth/password/forgot", { email, org_slug }),
  reset: (token: string, new_password: string) =>
    api.post("/auth/password/reset", { token, new_password }),
  inviteLookup: (token: string) =>
    api.get<{ email: string; role: Role; organization: { slug: string; name: string } | null }>(`/auth/invite/${token}`).then(r => r.data),
  inviteAccept: (token: string, full_name: string, password: string) =>
    api.post<TokenPair>("/auth/invite/accept", { token, full_name, password }).then(r => r.data),
  // 2FA pre-login
  totpVerify: (challenge: string, code: string) =>
    api.post<TokenPair & { organization?: { slug: string; name: string } | null }>("/auth/totp/verify", { challenge, code }).then(r => r.data),
  totpSetupFromChallenge: (challenge: string) =>
    api.post<TotpSetupData>("/auth/totp/setup-from-challenge", { challenge }).then(r => r.data),
  totpEnrollFromChallenge: (challenge: string, code: string) =>
    api.post<TokenPair & { organization?: { slug: string; name: string } | null }>("/auth/totp/enroll-from-challenge", { challenge, code }).then(r => r.data),
};

export const meApi = {
  updateProfile: (full_name: string) => api.patch<User>("/me", { full_name }).then(r => r.data),
  updateProfile2: (data: Partial<{ full_name: string; theme: "light" | "dark" | "system" }>) =>
    api.patch<User>("/me", data).then(r => r.data),
  changePassword: (current_password: string, new_password: string) =>
    api.post("/me/password", { current_password, new_password }),
  // 2FA self-service
  totpSetup: () => api.post<TotpSetupData>("/me/totp/setup").then(r => r.data),
  totpReenroll: (current_password: string) =>
    api.post<TotpSetupData>("/me/totp/reenroll", { current_password }).then(r => r.data),
  totpEnroll: (code: string) => api.post<User>("/me/totp/enroll", { code }).then(r => r.data),
  totpCancelSetup: () => api.post("/me/totp/cancel-setup"),
  totpDisable: (current_password: string, code?: string) =>
    api.post<User>("/me/totp/disable", { current_password, code }).then(r => r.data),
};

// ---- admin (global)
export const adminApi = {
  stats: () => api.get<{ organizations: number; users: number; requests: number }>("/admin/stats").then(r => r.data),
  listOrgs: () => api.get<Organization[]>("/admin/organizations").then(r => r.data),
  createOrg: (data: { name: string; slug?: string; seed_default_form?: boolean }) =>
    api.post<Organization>("/admin/organizations", data).then(r => r.data),
  updateOrg: (id: number, data: Partial<{ name: string; is_active: boolean; branding: any }>) =>
    api.patch<Organization>(`/admin/organizations/${id}`, data).then(r => r.data),
  deleteOrg: (id: number, confirm_name: string) =>
    api.post(`/admin/organizations/${id}/delete`, { confirm_name }),
  inviteClientAdmin: (orgId: number, email: string, full_name: string) =>
    api.post<User>(`/admin/organizations/${orgId}/client-admins`, { email, full_name, role: "client_admin" }).then(r => r.data),
  inviteUser: (data: { email: string; full_name: string; role: Role; organization_id?: number | null }) =>
    api.post<User>("/admin/invites", data).then(r => r.data),
  listAllUsers: (params?: { organization_id?: number; role?: Role }) =>
    api.get<User[]>("/admin/users", { params }).then(r => r.data),
  updateUser: (
    userId: number,
    data: Partial<{
      email: string;
      full_name: string;
      is_active: boolean;
      role: Role;
      can_approve_requests: boolean;
      organization_id: number | null;
    }>,
  ) => api.patch<User>(`/admin/users/${userId}`, data).then(r => r.data),
  forceResetUserPassword: (userId: number) => api.post(`/admin/users/${userId}/reset-password`),
  resendUserInvite: (userId: number) => api.post(`/admin/users/${userId}/resend-invite`),
  setUserPassword: (userId: number, new_password: string) =>
    api.post(`/admin/users/${userId}/password`, { new_password }),
  deleteUser: (userId: number) => api.delete(`/admin/users/${userId}`),
  resetUserTotp: (userId: number) => api.post(`/admin/users/${userId}/totp/reset`),
  // Database backup / restore
  downloadBackup: () => api.get<Blob>("/admin/backup", { responseType: "blob" }).then(r => r),
  restoreBackup: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ ok: boolean; message: string }>("/admin/backup/restore", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then(r => r.data);
  },
  listAllRequests: (params?: { organization_id?: number }) =>
    api.get<EmployeeRequest[]>("/admin/requests", { params }).then(r => r.data),
  getRequest: (id: number) =>
    api.get<{
      request: EmployeeRequest;
      organization: { id: number; name: string; slug: string } | null;
      submitter: { id: number; full_name: string; email: string } | null;
      schema: any;
    }>(`/admin/requests/${id}`).then(r => r.data),
  audit: (params?: { organization_id?: number; limit?: number; offset?: number; search?: string }) =>
    api.get<AuditEntry[]>("/admin/audit", { params }).then(r => ({
      items: r.data,
      total: Number(r.headers["x-total-count"] ?? r.data.length),
    })),
  getSettings: () =>
    api.get<PlatformSettings>("/admin/settings").then(r => r.data),
  updateSettings: (data: Partial<{ platform_name: string; default_support_email: string; default_from_email: string; default_from_name: string; default_dashboard_columns: string[]; timezone: string; public_base_url: string; backend_port: number }> & SmtpConfigUpdate) =>
    api.patch<PlatformSettings>("/admin/settings", data).then(r => r.data),
  restart: () =>
    api.post<{ status: string; service: string; message?: string }>("/admin/restart").then(r => r.data),
  getOrgSmtp: (orgId: number) =>
    api.get<OrganizationSmtp>(`/admin/organizations/${orgId}/smtp`).then(r => r.data),
  updateOrgSmtp: (orgId: number, data: SmtpConfigUpdate) =>
    api.patch<OrganizationSmtp>(`/admin/organizations/${orgId}/smtp`, data).then(r => r.data),
  testSmtp: (scope: "platform" | "org", orgId?: number, sendTo?: string) =>
    api.post<{ ok: boolean; message: string; host: string; port: number; security: string; auth: string; username: string; usable: boolean; sent: boolean; send_message: string }>(
      "/admin/smtp-test",
      { scope, org_id: orgId, send_to: sendTo },
    ).then(r => r.data),
  uploadPlatformLogo: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.put("/branding/platform/logo", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deletePlatformLogo: () => api.delete("/branding/platform/logo"),
};

// ---- org-scoped
export const orgApi = {
  get: (slug: string) => api.get<Organization>(`/orgs/${slug}`).then(r => r.data),
  listUsers: (slug: string) => api.get<User[]>(`/orgs/${slug}/users`).then(r => r.data),
  inviteUser: (slug: string, data: { email: string; full_name: string; role: Role; can_approve_requests?: boolean }) =>
    api.post<User>(`/orgs/${slug}/users`, data).then(r => r.data),
  updateUser: (slug: string, userId: number, data: Partial<{ full_name: string; is_active: boolean; role: Role; can_approve_requests: boolean }>) =>
    api.patch<User>(`/orgs/${slug}/users/${userId}`, data).then(r => r.data),
  deleteUser: (slug: string, userId: number) => api.delete(`/orgs/${slug}/users/${userId}`),
  resendUserInvite: (slug: string, userId: number) => api.post(`/orgs/${slug}/users/${userId}/resend-invite`),
  resetUserPassword: (slug: string, userId: number) => api.post(`/orgs/${slug}/users/${userId}/reset-password`),

  getForm: (slug: string) => api.get<FormSchemaResp>(`/orgs/${slug}/form`).then(r => r.data),
  saveForm: (slug: string, schema: FormSchemaDoc) =>
    api.put<FormSchemaResp>(`/orgs/${slug}/form`, { schema }).then(r => r.data),

  listRequests: (slug: string, params?: { status?: RequestStatus; q?: string; mine_only?: boolean }) =>
    api.get<EmployeeRequest[]>(`/orgs/${slug}/requests`, { params }).then(r => r.data),
  createRequest: (slug: string, data: { request_type: string; subject?: string; payload: Record<string, any> }) =>
    api.post<EmployeeRequest>(`/orgs/${slug}/requests`, data).then(r => r.data),
  getRequest: (slug: string, id: number) =>
    api.get<EmployeeRequest>(`/orgs/${slug}/requests/${id}`).then(r => r.data),
  updateRequest: (slug: string, id: number, data: Partial<{ status: RequestStatus; subject: string; payload: any; notes: string; support_message: string }>) =>
    api.patch<EmployeeRequest>(`/orgs/${slug}/requests/${id}`, data).then(r => r.data),
  approveRequest: (slug: string, id: number) =>
    api.post<EmployeeRequest>(`/orgs/${slug}/requests/${id}/approve`).then(r => r.data),
  rejectRequest: (slug: string, id: number) =>
    api.post<EmployeeRequest>(`/orgs/${slug}/requests/${id}/reject`).then(r => r.data),
  submitRequest: (slug: string, id: number) =>
    api.post<EmployeeRequest>(`/orgs/${slug}/requests/${id}/submit`).then(r => r.data),
  resubmitRequest: (slug: string, id: number) =>
    api.post<EmployeeRequest>(`/orgs/${slug}/requests/${id}/resubmit`).then(r => r.data),
  deleteRequest: (slug: string, id: number) =>
    api.delete(`/orgs/${slug}/requests/${id}`),
  exportRequestUrl: (slug: string, id: number) => `/api/v1/orgs/${slug}/requests/${id}/export`,

  updateSettings: (slug: string, data: Partial<{ name: string; support_email: string; from_email: string; from_name: string; dashboard_columns: string[]; branding: any }>) =>
    api.patch<Organization>(`/orgs/${slug}/settings`, data).then(r => r.data),

  uploadLogo: (slug: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.put(`/branding/orgs/${slug}/logo`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteLogo: (slug: string) => api.delete(`/branding/orgs/${slug}/logo`),

  // resource catalog
  listResources: (slug: string, params?: { kind?: ResourceKind; include_inactive?: boolean }) =>
    api.get<OrgResource[]>(`/orgs/${slug}/resources`, { params }).then(r => r.data),
  createResource: (slug: string, data: { kind: ResourceKind; name: string; attributes?: Record<string, any>; linked_resource_ids?: number[]; is_active?: boolean }) =>
    api.post<OrgResource>(`/orgs/${slug}/resources`, data).then(r => r.data),
  updateResource: (slug: string, id: number, data: Partial<{ name: string; attributes: Record<string, any>; linked_resource_ids: number[]; is_active: boolean }>) =>
    api.patch<OrgResource>(`/orgs/${slug}/resources/${id}`, data).then(r => r.data),
  deleteResource: (slug: string, id: number) =>
    api.delete(`/orgs/${slug}/resources/${id}`),
  bulkResources: (slug: string, rows: Array<{ action?: "upsert" | "add" | "update" | "delete"; kind: string; name: string; attributes?: Record<string, any>; is_active?: boolean }>) =>
    api.post<{ created: number; updated: number; deleted: number; skipped: number; errors: number; rows: Array<{ row: number; action: string; kind: string; name: string; result: string; detail?: string; id?: number }> }>(`/orgs/${slug}/resources/bulk`, { rows }).then(r => r.data),

  // employee directory
  searchEmployees: (slug: string, params?: { q?: string; status?: "active" | "terminated"; limit?: number }) =>
    api.get<Employee[]>(`/orgs/${slug}/employees`, { params }).then(r => r.data),
  getEmployee: (slug: string, id: number) =>
    api.get<Employee>(`/orgs/${slug}/employees/${id}`).then(r => r.data),
};
