import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { adminApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Role, User } from "@/types";
import { useAuth } from "@/auth/AuthContext";

export default function AdminUsers() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [role, setRole] = useState<Role | "">("");
  const [orgId, setOrgId] = useState<string>("");
  const orgs = useQuery({ queryKey: ["orgs"], queryFn: adminApi.listOrgs });
  const users = useQuery({
    queryKey: ["admin.users.all", role],
    queryFn: () => adminApi.listAllUsers({ role: (role || undefined) as Role | undefined }),
  });

  const invalidateUsers = () => qc.invalidateQueries({ queryKey: ["admin.users.all"] });

  const reset = useMutation({
    mutationFn: (uid: number) => adminApi.forceResetUserPassword(uid),
    onSuccess: () => toast.success("Reset link sent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const resendInvite = useMutation({
    mutationFn: (uid: number) => adminApi.resendUserInvite(uid),
    onSuccess: () => toast.success("Invite resent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const reset2fa = useMutation({
    mutationFn: (uid: number) => adminApi.resetUserTotp(uid),
    onSuccess: () => { toast.success("2FA cleared — user must re-enroll on next sign-in"); invalidateUsers(); },
    onError: (e) => toast.error(apiError(e)),
  });

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [iEmail, setIEmail] = useState("");
  const [iName, setIName] = useState("");
  const [iRole, setIRole] = useState<Role>("user");
  const [iOrg, setIOrg] = useState<string>("");
  const invite = useMutation({
    mutationFn: () => adminApi.inviteUser({
      email: iEmail.trim(),
      full_name: iName.trim(),
      role: iRole,
      organization_id: iRole === "global_admin" ? null : (iOrg ? Number(iOrg) : undefined),
    }),
    onSuccess: () => {
      toast.success("Invitation sent");
      invalidateUsers();
      setInviteOpen(false);
      setIEmail(""); setIName(""); setIRole("user"); setIOrg("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Set password modal
  const [pwUser, setPwUser] = useState<User | null>(null);
  const [newPw, setNewPw] = useState("");
  const setPassword = useMutation({
    mutationFn: () => adminApi.setUserPassword(pwUser!.id, newPw),
    onSuccess: () => {
      toast.success("Password updated");
      setPwUser(null);
      setNewPw("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  // Delete confirm modal
  const [delUser, setDelUser] = useState<User | null>(null);
  const [delConfirm, setDelConfirm] = useState("");
  const remove = useMutation({
    mutationFn: () => adminApi.deleteUser(delUser!.id),
    onSuccess: () => {
      toast.success("User deleted");
      invalidateUsers();
      setDelUser(null);
      setDelConfirm("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const orgName = (id: number | null) => orgs.data?.find((o) => o.id === id)?.name || "—";

  const filtered = users.data?.filter((u) => {
    if (!orgId) return true;
    if (orgId === "none") return u.organization_id == null;
    return String(u.organization_id) === orgId;
  });

  const inviteValid = iEmail.trim() && iName.trim() && (iRole === "global_admin" || iOrg);

  return (
    <>
      <PageHeader title="All Users" description="Every user across every organization."
        actions={
          <div className="flex gap-2">
            <select className="input max-w-xs" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="">All organizations</option>
              <option value="none">No organization</option>
              {orgs.data?.map((o) => (
                <option key={o.id} value={String(o.id)}>{o.name}</option>
              ))}
            </select>
            <select className="input max-w-xs" value={role} onChange={(e) => setRole(e.target.value as any)}>
              <option value="">All roles</option>
              <option value="global_admin">Global Admin</option>
              <option value="client_admin">Client Admin</option>
              <option value="user">Standard User</option>
            </select>
            <button className="btn-primary" onClick={() => setInviteOpen(true)}>Invite user</button>
          </div>
        } />
      {users.isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Organization</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {filtered?.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name || <span className="text-slate-400 italic">pending</span>}</td>
                  <td>{u.email}</td>
                  <td><span className="badge-blue">{u.role}</span></td>
                  <td>{orgName(u.organization_id)}</td>
                  <td>{u.is_active ? "yes" : "no"}</td>
                  <td className="text-right whitespace-nowrap">
                    {!u.has_password && (
                      <button
                        className="btn-ghost"
                        disabled={resendInvite.isPending}
                        title="Send a new invite link to this user"
                        onClick={() => resendInvite.mutate(u.id)}
                      >Resend invite</button>
                    )}
                    <button className="btn-ghost" onClick={() => reset.mutate(u.id)}>Reset password</button>
                    <button className="btn-ghost" onClick={() => { setPwUser(u); setNewPw(""); }}>Change password</button>
                    <button
                      className="btn-ghost"
                      disabled={!u.totp_enrolled || reset2fa.isPending}
                      title={u.totp_enrolled ? "Clear this user's authenticator enrollment" : "User has no 2FA enrolled"}
                      onClick={() => {
                        if (window.confirm(`Clear two-factor authentication for ${u.email}? They'll be required to set up a new authenticator on next sign-in.`)) {
                          reset2fa.mutate(u.id);
                        }
                      }}
                    >Reset 2FA</button>
                    <button
                      className="btn-ghost text-red-600"
                      disabled={u.id === me?.id}
                      title={u.id === me?.id ? "You cannot delete your own account" : ""}
                      onClick={() => { setDelUser(u); setDelConfirm(""); }}
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite user">
        <div className="space-y-3">
          <div>
            <label className="label">Role</label>
            <select className="input" value={iRole} onChange={(e) => setIRole(e.target.value as Role)}>
              <option value="user">Standard User</option>
              <option value="client_admin">Client Admin</option>
              <option value="global_admin">Global Admin (team member)</option>
            </select>
          </div>
          {iRole !== "global_admin" && (
            <div>
              <label className="label">Organization <span className="text-red-500">*</span></label>
              <select className="input" value={iOrg} onChange={(e) => setIOrg(e.target.value)}>
                <option value="">Select an organization…</option>
                {orgs.data?.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Full name</label>
            <input className="input" value={iName} onChange={(e) => setIName(e.target.value)} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={iEmail} onChange={(e) => setIEmail(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!inviteValid || invite.isPending}
              onClick={() => invite.mutate()}
            >{invite.isPending ? "Sending…" : "Send invite"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!pwUser} onClose={() => setPwUser(null)} title="Change password">
        {pwUser && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Set a new password for <b>{pwUser.email}</b>. Min 8 characters.</p>
            <input
              type="password"
              className="input"
              autoFocus
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="New password"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setPwUser(null)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={newPw.length < 8 || setPassword.isPending}
                onClick={() => setPassword.mutate()}
              >{setPassword.isPending ? "Saving…" : "Update password"}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!delUser} onClose={() => setDelUser(null)} title="Delete user">
        {delUser && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              This permanently deletes <b>{delUser.full_name || delUser.email}</b> and any data tied to this user.
              This cannot be undone.
            </p>
            <p className="text-sm text-slate-600">Type the user's email <span className="font-mono">{delUser.email}</span> to confirm.</p>
            <input
              className="input"
              value={delConfirm}
              onChange={(e) => setDelConfirm(e.target.value)}
              placeholder={delUser.email}
            />
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setDelUser(null)}>Cancel</button>
              <button
                className="btn-danger"
                disabled={delConfirm !== delUser.email || remove.isPending}
                onClick={() => remove.mutate()}
              >{remove.isPending ? "Deleting…" : "Permanently delete"}</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
