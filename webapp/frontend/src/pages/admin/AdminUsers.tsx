import { useEffect, useState } from "react";
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

  const resendInvite = useMutation({
    mutationFn: (uid: number) => adminApi.resendUserInvite(uid),
    onSuccess: () => toast.success("Invite resent"),
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

  // Edit modal
  const [editUser, setEditUser] = useState<User | null>(null);

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
                    <button className="btn-ghost" onClick={() => setEditUser(u)}>Edit</button>
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
            <label className="label" htmlFor="inv-role">Role</label>
            <select id="inv-role" className="input" value={iRole} onChange={(e) => setIRole(e.target.value as Role)}>
              <option value="user">Standard User</option>
              <option value="client_admin">Client Admin</option>
              <option value="global_admin">Global Admin (team member)</option>
            </select>
          </div>
          {iRole !== "global_admin" && (
            <div>
              <label className="label" htmlFor="inv-org">Organization <span className="text-red-500">*</span></label>
              <select id="inv-org" className="input" value={iOrg} onChange={(e) => setIOrg(e.target.value)}>
                <option value="">Select an organization…</option>
                {orgs.data?.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="inv-name">Full name</label>
            <input id="inv-name" className="input" value={iName} onChange={(e) => setIName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="inv-email">Email</label>
            <input id="inv-email" type="email" className="input" value={iEmail} onChange={(e) => setIEmail(e.target.value)} />
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

      <EditUserModal
        user={editUser}
        orgs={orgs.data ?? []}
        isSelf={!!editUser && editUser.id === me?.id}
        onClose={() => setEditUser(null)}
        onChanged={(updated) => {
          invalidateUsers();
          // Keep the modal open with refreshed data after edits, but close when
          // the user is deleted.
          if (updated === null) setEditUser(null);
          else setEditUser(updated);
        }}
      />
    </>
  );
}

function EditUserModal({
  user, orgs, isSelf, onClose, onChanged,
}: {
  user: User | null;
  orgs: { id: number; name: string }[];
  isSelf: boolean;
  onClose: () => void;
  onChanged: (updated: User | null) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [orgId, setOrgId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [canApprove, setCanApprove] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name || "");
    setEmail(user.email);
    setRole(user.role);
    setOrgId(user.organization_id != null ? String(user.organization_id) : "");
    setIsActive(user.is_active);
    setCanApprove(!!user.can_approve_requests);
  }, [user]);

  // Confirm/sub-modals
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState("");

  const save = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("No user");
      const payload: any = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        is_active: isActive,
        can_approve_requests: canApprove,
        organization_id: role === "global_admin" ? null : (orgId ? Number(orgId) : null),
      };
      return adminApi.updateUser(user.id, payload);
    },
    onSuccess: (updated) => {
      toast.success("User updated");
      onChanged(updated);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const resetPwLink = useMutation({
    mutationFn: () => adminApi.forceResetUserPassword(user!.id),
    onSuccess: () => toast.success("Reset link sent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const setPassword = useMutation({
    mutationFn: () => adminApi.setUserPassword(user!.id, newPw),
    onSuccess: () => {
      toast.success("Password updated");
      setPwOpen(false);
      setNewPw("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const reset2fa = useMutation({
    mutationFn: () => adminApi.resetUserTotp(user!.id),
    onSuccess: () => {
      toast.success("2FA cleared — user must re-enroll on next sign-in");
      onChanged(user);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const remove = useMutation({
    mutationFn: () => adminApi.deleteUser(user!.id),
    onSuccess: () => {
      toast.success("User deleted");
      setDelOpen(false);
      setDelConfirm("");
      onChanged(null);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const resendInvite = useMutation({
    mutationFn: () => adminApi.resendUserInvite(user!.id),
    onSuccess: () => toast.success("Invite resent"),
    onError: (e) => toast.error(apiError(e)),
  });

  if (!user) return null;

  const orgRequired = role !== "global_admin";
  const formValid = email.trim() && fullName.trim() && (!orgRequired || !!orgId);

  return (
    <Modal open={!!user} onClose={onClose} title={`Edit ${user.email}`} size="lg">
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="edituser-name">Full name</label>
              <input id="edituser-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="edituser-email">Email</label>
              <input id="edituser-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="edituser-role">Role</label>
              <select
                id="edituser-role"
                className="input"
                value={role}
                onChange={(e) => {
                  const r = e.target.value as Role;
                  setRole(r);
                  if (r === "global_admin") setOrgId("");
                }}
              >
                <option value="user">Standard User</option>
                <option value="client_admin">Client Admin</option>
                <option value="global_admin">Global Admin</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="edituser-org">Organization {orgRequired && <span className="text-red-500">*</span>}</label>
              <select
                id="edituser-org"
                className="input"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                disabled={!orgRequired}
              >
                <option value="">{orgRequired ? "Select an organization…" : "— none —"}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={String(o.id)}>{o.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                disabled={isSelf}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={canApprove}
                onChange={(e) => setCanApprove(e.target.checked)}
              />
              <span>Can approve requests</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={onClose}>Close</button>
            <button
              className="btn-primary"
              disabled={!formValid || save.isPending}
              onClick={() => save.mutate()}
            >{save.isPending ? "Saving…" : "Save changes"}</button>
          </div>
        </section>

        <section className="border-t border-slate-200 dark:border-slate-700 pt-4">
          <h3 className="font-semibold text-sm mb-2">Account actions</h3>
          <div className="flex flex-wrap gap-2">
            {!user.has_password && (
              <button
                className="btn-secondary"
                disabled={resendInvite.isPending}
                onClick={() => resendInvite.mutate()}
              >Resend invite</button>
            )}
            <button
              className="btn-secondary"
              disabled={resetPwLink.isPending}
              onClick={() => resetPwLink.mutate()}
              title="Email the user a password reset link"
            >Send password reset</button>
            <button
              className="btn-secondary"
              onClick={() => { setNewPw(""); setPwOpen(true); }}
            >Change password…</button>
            <button
              className="btn-secondary"
              disabled={!user.totp_enrolled || reset2fa.isPending}
              title={user.totp_enrolled ? "Clear this user's authenticator enrollment" : "User has no 2FA enrolled"}
              onClick={() => {
                if (window.confirm(`Clear two-factor authentication for ${user.email}? They'll be required to set up a new authenticator on next sign-in.`)) {
                  reset2fa.mutate();
                }
              }}
            >Reset 2FA</button>
          </div>
        </section>

        <section className="border-t border-red-200 dark:border-red-900/40 pt-4">
          <h3 className="font-semibold text-sm mb-2 text-red-700 dark:text-red-400">Danger zone</h3>
          <button
            className="btn-danger"
            disabled={isSelf}
            title={isSelf ? "You cannot delete your own account" : ""}
            onClick={() => { setDelConfirm(""); setDelOpen(true); }}
          >Delete user</button>
        </section>
      </div>

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Set a new password for <b>{user.email}</b>. Min 8 characters.</p>
          <input
            type="password"
            className="input"
            autoFocus
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password"
          />
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setPwOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={newPw.length < 8 || setPassword.isPending}
              onClick={() => setPassword.mutate()}
            >{setPassword.isPending ? "Saving…" : "Update password"}</button>
          </div>
        </div>
      </Modal>

      <Modal open={delOpen} onClose={() => setDelOpen(false)} title="Delete user">
        <div className="space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            This permanently deletes <b>{user.full_name || user.email}</b> and any data tied to this user. This cannot be undone.
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">Type the user's email <span className="font-mono">{user.email}</span> to confirm.</p>
          <input
            className="input"
            value={delConfirm}
            onChange={(e) => setDelConfirm(e.target.value)}
            placeholder={user.email}
          />
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setDelOpen(false)}>Cancel</button>
            <button
              className="btn-danger"
              disabled={delConfirm !== user.email || remove.isPending}
              onClick={() => remove.mutate()}
            >{remove.isPending ? "Deleting…" : "Permanently delete"}</button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
