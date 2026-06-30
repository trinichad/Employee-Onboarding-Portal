import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { KeyRound, Plus, Trash2, Mail } from "lucide-react";
import { orgApi } from "@/api";
import { apiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { Modal } from "@/components/Modal";
import { PageHeader, Spinner } from "@/components/ui";
import type { Role } from "@/types";

export default function OrgUsers() {
  const { orgSlug = "" } = useParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isGlobal = user?.role === "global_admin";
  const users = useQuery({ queryKey: ["org.users", orgSlug], queryFn: () => orgApi.listUsers(orgSlug) });

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [canApprove, setCanApprove] = useState(false);

  const invite = useMutation({
    mutationFn: () => orgApi.inviteUser(orgSlug, { email, full_name: name, role, can_approve_requests: canApprove }),
    onSuccess: () => {
      toast.success("Invitation sent");
      qc.invalidateQueries({ queryKey: ["org.users", orgSlug] });
      setOpen(false); setEmail(""); setName(""); setRole("user"); setCanApprove(false);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const reset = useMutation({
    mutationFn: (uid: number) => orgApi.resetUserPassword(orgSlug, uid),
    onSuccess: () => toast.success("Reset link sent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const resendInvite = useMutation({
    mutationFn: (uid: number) => orgApi.resendUserInvite(orgSlug, uid),
    onSuccess: () => toast.success("Invite resent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const toggle = useMutation({
    mutationFn: (vars: { uid: number; active: boolean }) => orgApi.updateUser(orgSlug, vars.uid, { is_active: vars.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org.users", orgSlug] }),
    onError: (e) => toast.error(apiError(e)),
  });

  const toggleApprover = useMutation({
    mutationFn: (vars: { uid: number; can_approve: boolean }) => orgApi.updateUser(orgSlug, vars.uid, { can_approve_requests: vars.can_approve }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["org.users", orgSlug] }),
    onError: (e) => toast.error(apiError(e)),
  });

  const del = useMutation({
    mutationFn: (uid: number) => orgApi.deleteUser(orgSlug, uid),
    onSuccess: () => { toast.success("User deleted"); qc.invalidateQueries({ queryKey: ["org.users", orgSlug] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  return (
    <>
      <PageHeader title="Users" description="Manage users in this organization."
        actions={<button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Invite user</button>} />
      {users.isLoading ? <Spinner /> : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Approver</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {users.data?.map((u) => {
                const isAdminRow = u.role === "global_admin" || u.role === "client_admin";
                return (
                <tr key={u.id}>
                  <td>{u.full_name || <span className="text-slate-400 italic">pending</span>}</td>
                  <td>{u.email}</td>
                  <td><span className="badge-blue">{u.role}</span></td>
                  <td>
                    <input
                      type="checkbox"
                      disabled={isAdminRow}
                      title={isAdminRow ? "Admins always approve" : "Allow this user to approve requests"}
                      checked={isAdminRow || !!u.can_approve_requests}
                      onChange={(e) => toggleApprover.mutate({ uid: u.id, can_approve: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={u.is_active} onChange={(e) => toggle.mutate({ uid: u.id, active: e.target.checked })} />
                  </td>
                  <td className="text-right space-x-1">
                    {!u.has_password && (
                      <button
                        className="btn-ghost"
                        disabled={resendInvite.isPending}
                        title="Send a new invite link to this user"
                        onClick={() => resendInvite.mutate(u.id)}
                      ><Mail size={14} /> Resend invite</button>
                    )}
                    <button className="btn-ghost" onClick={() => reset.mutate(u.id)}><KeyRound size={14} /> Reset</button>
                    <button className="btn-ghost text-red-600" onClick={() => { if (confirm(`Delete ${u.email}?`)) del.mutate(u.id); }}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Invite user">
        <div className="space-y-4">
          <div><label className="label" htmlFor="orguser-name">Full name</label>
            <input id="orguser-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="orguser-email">Email</label>
            <input id="orguser-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="orguser-role">Role</label>
            <select id="orguser-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user">Standard User</option>
              {isGlobal && <option value="client_admin">Client Admin</option>}
            </select>
            {!isGlobal && <p className="help">Only Global Admins can create Client Admins.</p>}
          </div>
          {role === "user" && (
            <div className="flex items-center gap-2">
              <input id="can-approve" type="checkbox" checked={canApprove} onChange={(e) => setCanApprove(e.target.checked)} />
              <label htmlFor="can-approve" className="text-sm">Allow this user to approve and send employee requests</label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!email || !name || invite.isPending} onClick={() => invite.mutate()}>
              {invite.isPending ? "Sending…" : "Send invite"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
