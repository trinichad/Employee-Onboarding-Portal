import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, KeyRound, Trash2, UserPlus } from "lucide-react";
import { adminApi, orgApi } from "@/api";
import { apiError } from "@/api/client";
import { Modal } from "@/components/Modal";
import { PageHeader, Spinner } from "@/components/ui";
import { SmtpForm } from "@/components/SmtpForm";
import { formatDate } from "@/lib/platform";

export default function AdminOrgDetail() {
  const { orgId } = useParams();
  const id = Number(orgId);
  const qc = useQueryClient();
  const nav = useNavigate();

  const orgs = useQuery({ queryKey: ["orgs"], queryFn: adminApi.listOrgs });
  const org = orgs.data?.find((o) => o.id === id);

  const users = useQuery({
    queryKey: ["admin.users", id],
    queryFn: () => adminApi.listAllUsers({ organization_id: id }),
    enabled: !!id,
  });

  const orgSmtp = useQuery({
    queryKey: ["admin.org.smtp", id],
    queryFn: () => adminApi.getOrgSmtp(id),
    enabled: !!id,
  });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const invite = useMutation({
    mutationFn: () => adminApi.inviteClientAdmin(id, email, name),
    onSuccess: () => {
      toast.success("Client admin invited");
      qc.invalidateQueries({ queryKey: ["admin.users", id] });
      setInviteOpen(false); setEmail(""); setName("");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const reset = useMutation({
    mutationFn: (uid: number) => adminApi.forceResetUserPassword(uid),
    onSuccess: () => toast.success("Reset link sent"),
    onError: (e) => toast.error(apiError(e)),
  });

  const [delOpen, setDelOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const del = useMutation({
    mutationFn: () => adminApi.deleteOrg(id, confirm),
    onSuccess: () => {
      toast.success("Organization deleted");
      qc.invalidateQueries({ queryKey: ["orgs"] });
      nav("/admin/organizations");
    },
    onError: (e) => toast.error(apiError(e)),
  });

  if (orgs.isLoading) return <Spinner />;
  if (!org) return <div>Organization not found.</div>;

  return (
    <>
      <PageHeader title={org.name} description={`Slug: ${org.slug} · Created ${formatDate(org.created_at)}`}
        actions={<>
          <Link className="btn-secondary" to={`/${org.slug}`} target="_blank">Open portal ↗</Link>
          <Link className="btn-secondary" to={`/${org.slug}/resources`}>Manage Resources</Link>
          <Link className="btn-secondary" to={`/${org.slug}/form`}>Form Builder</Link>
          <button className="btn-primary" onClick={() => setInviteOpen(true)}><UserPlus size={14} /> Invite Client Admin</button>
        </>} />

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card">
          <div className="card-header"><h3 className="font-semibold">Users in this organization</h3></div>
          <div className="card-body">
            {users.isLoading ? <Spinner /> : users.data?.length ? (
              <div className="table-wrap">
                <table className="dt">
                  <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead>
                  <tbody>
                    {users.data.map((u) => (
                      <tr key={u.id}>
                        <td>{u.full_name || <span className="text-slate-400 italic">— pending —</span>}</td>
                        <td>{u.email}</td>
                        <td><span className="badge-blue">{u.role}</span></td>
                        <td>{u.is_active ? "yes" : "no"}</td>
                        <td className="text-right">
                          <button className="btn-ghost" onClick={() => reset.mutate(u.id)}><KeyRound size={14} /> Reset password</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-slate-500">No users yet.</p>}
          </div>
        </div>

        <div className="card border-red-200 ring-red-100">
          <div className="card-header bg-red-50/40">
            <h3 className="font-semibold text-red-700 flex items-center gap-2"><AlertTriangle size={16} /> Danger zone</h3>
          </div>
          <div className="card-body">
            <p className="text-sm text-slate-600">Deleting an organization permanently removes its users, forms, and requests.</p>
            <button className="btn-danger mt-4 w-full" onClick={() => setDelOpen(true)}><Trash2 size={14} /> Delete organization</button>
          </div>
        </div>
      </div>

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <OrgLogoCard
          slug={org.slug}
          logoUrl={org.logo_url || null}
          onChanged={async () => { await qc.invalidateQueries({ queryKey: ["orgs"] }); }}
        />
      </div>

      {orgSmtp.data && (
        <div className="mt-6">
          <SmtpForm
            value={orgSmtp.data}
            testScope={{ scope: "org", orgId: id }}
            badge={
              <span className="ml-2 text-xs font-normal text-slate-500">
                {orgSmtp.data.smtp_host
                  ? "(override active)"
                  : "(falling back to platform SMTP)"}
              </span>
            }
            description={
              "Optional per-organization SMTP override. When configured, this organization's outbound email " +
              "(approval requests, approvals, support submissions, invites, password resets) will use these settings " +
              "instead of the platform-wide SMTP. Leave host blank to use the platform default. " +
              "This card is visible only to global admins."
            }
            onSave={async (patch) => {
              await adminApi.updateOrgSmtp(id, patch);
              qc.invalidateQueries({ queryKey: ["admin.org.smtp", id] });
            }}
          />
        </div>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite Client Admin">
        <div className="space-y-4">
          <div><label className="label">Full name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!email || !name || invite.isPending} onClick={() => invite.mutate()}>Send invite</button>
          </div>
        </div>
      </Modal>

      <Modal open={delOpen} onClose={() => { setDelOpen(false); setConfirm(""); }} title="Delete organization?">
        <div className="space-y-4">
          <div className="rounded-lg bg-red-50 ring-1 ring-red-200 p-3 text-sm text-red-800">
            <div className="font-semibold flex items-center gap-2"><AlertTriangle size={16} /> This is permanent.</div>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>All users in this organization will lose access</li>
              <li>All submitted requests will be permanently deleted</li>
              <li>All form configurations will be lost</li>
            </ul>
          </div>
          <div>
            <label className="label">Type <code className="bg-slate-100 px-1 rounded">{org.name}</code> to confirm</label>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDelOpen(false)}>Cancel</button>
            <button className="btn-danger" disabled={confirm !== org.name || del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? "Deleting…" : "Permanently delete"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function OrgLogoCard({ slug, logoUrl, onChanged }: { slug: string; logoUrl: string | null; onChanged: () => Promise<void> | void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [bust, setBust] = useState(0);
  const onPick = () => fileRef.current?.click();
  const onUpload = async (f: File) => {
    setBusy(true);
    try {
      await orgApi.uploadLogo(slug, f);
      setBust(Date.now());
      await onChanged();
      toast.success("Logo updated");
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const onRemove = async () => {
    setBusy(true);
    try {
      await orgApi.deleteLogo(slug);
      await onChanged();
      toast.success("Logo removed");
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };
  const src = logoUrl ? `${logoUrl}?v=${bust || "x"}` : null;
  return (
    <div className="card">
      <div className="card-header"><h3 className="font-semibold">Organization logo</h3></div>
      <div className="card-body space-y-3">
        <p className="text-xs text-slate-500">Shown in this organization's sidebar. PNG, JPG, WEBP, SVG, GIF, or ICO. Max 2 MB.</p>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-lg border border-slate-200 dark:border-slate-700 bg-white grid place-items-center overflow-hidden">
            {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,image/vnd.microsoft.icon,image/x-icon"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); }}
            />
            <button className="btn" disabled={busy} onClick={onPick}>{logoUrl ? "Replace…" : "Upload…"}</button>
            {logoUrl ? <button className="btn-secondary" disabled={busy} onClick={onRemove}>Remove</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
