import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { adminApi, orgApi } from "@/api";
import { apiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader, Spinner } from "@/components/ui";
import { SmtpForm } from "@/components/SmtpForm";
import { ALL_COLUMNS, DEFAULT_COLUMNS } from "@/pages/org/OrgDashboard";

export default function OrgSettings() {
  const { orgSlug = "" } = useParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "global_admin";
  const org = useQuery({ queryKey: ["org", orgSlug], queryFn: () => orgApi.get(orgSlug) });

  const orgSmtp = useQuery({
    queryKey: ["admin.org.smtp", org.data?.id],
    queryFn: () => adminApi.getOrgSmtp(org.data!.id),
    enabled: isGlobalAdmin && !!org.data?.id,
  });

  const [supportEmail, setSupportEmail] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);

  useEffect(() => {
    if (org.data) {
      setSupportEmail(org.data.support_email || "");
      setFromEmail(org.data.from_email || "");
      setFromName(org.data.from_name || "");
      setColumns(org.data.dashboard_columns?.length ? org.data.dashboard_columns : DEFAULT_COLUMNS);
    }
  }, [org.data]);

  const save = useMutation({
    mutationFn: () => orgApi.updateSettings(orgSlug, {
      support_email: supportEmail,
      from_email: fromEmail,
      from_name: fromName,
      dashboard_columns: columns,
    }),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["org", orgSlug] });
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const toggleCol = (key: string) => {
    setColumns((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const move = (key: string, dir: -1 | 1) => {
    setColumns((prev) => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const orderedSelected = useMemo(() => columns.filter((k) => ALL_COLUMNS.some((c) => c.key === k)), [columns]);
  const unselected = ALL_COLUMNS.filter((c) => !columns.includes(c.key));

  if (org.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader title="Organization settings" description="Configure how requests are routed and what's displayed on the dashboard." />

      <div className="grid md:grid-cols-2 gap-4">
        <OrgLogoCard
          slug={orgSlug}
          logoUrl={org.data?.logo_url || null}
          onChanged={async () => { await qc.invalidateQueries({ queryKey: ["org", orgSlug] }); }}
        />
        <div className="card">
          <div className="card-header"><h3 className="font-semibold">Email</h3></div>
          <div className="card-body space-y-4">
            <div>
              <label className="label">Team support email (To)</label>
              <input className="input" type="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@example.com" />
              <p className="text-xs text-slate-500 mt-1">When a request is approved and sent, the full request is emailed to this address so your team can handle the new employee setup.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Sender email (From)</label>
                <input className="input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="noreply@yourdomain.com" />
              </div>
              <div>
                <label className="label">Sender name</label>
                <input className="input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Acme IT" />
              </div>
            </div>
            <p className="text-xs text-slate-500">Outbound notifications (approval requests, approvals, support submissions, invites and password resets) will be sent from this address. If you use SMTP2GO, the sender must be a verified sender on your account. Leave blank to fall back to the platform default.</p>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="font-semibold">Dashboard recent activity columns</h3></div>
          <div className="card-body space-y-3">
            <p className="text-sm text-slate-600">Choose which columns are displayed in the Recent activity table on the dashboard.</p>

            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Visible (in order)</div>
              <ul className="space-y-1">
                {orderedSelected.map((k) => {
                  const col = ALL_COLUMNS.find((c) => c.key === k)!;
                  return (
                    <li key={k} className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm">
                      <span>{col.label}</span>
                      <span className="space-x-1">
                        <button type="button" className="btn-ghost" onClick={() => move(k, -1)}>↑</button>
                        <button type="button" className="btn-ghost" onClick={() => move(k, 1)}>↓</button>
                        <button type="button" className="btn-ghost text-red-600" onClick={() => toggleCol(k)}>Remove</button>
                      </span>
                    </li>
                  );
                })}
                {orderedSelected.length === 0 && <li className="text-sm text-slate-500 italic">No columns selected.</li>}
              </ul>
            </div>

            {unselected.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Available</div>
                <div className="flex flex-wrap gap-2">
                  {unselected.map((c) => (
                    <button key={c.key} type="button" className="btn-secondary" onClick={() => toggleCol(c.key)}>+ {c.label}</button>
                  ))}
                </div>
              </div>
            )}

            <button type="button" className="btn-ghost text-xs" onClick={() => setColumns(DEFAULT_COLUMNS)}>Reset to defaults</button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>

      {isGlobalAdmin && orgSmtp.data && (
        <div className="mt-6">
          <SmtpForm
            value={orgSmtp.data}
            testScope={{ scope: "org", orgId: org.data!.id }}
            badge={
              <span className="ml-2 text-xs font-normal text-slate-500">
                {orgSmtp.data.smtp_host
                  ? "(override active — global admin only)"
                  : "(falling back to platform SMTP — global admin only)"}
              </span>
            }
            description={
              "Optional per-organization SMTP override. Visible and editable only by global admins. " +
              "When configured, this organization's outbound email (approval requests, approvals, support submissions, invites, password resets) " +
              "will use these settings instead of the platform-wide SMTP. Leave host blank to use the platform default."
            }
            onSave={async (patch) => {
              await adminApi.updateOrgSmtp(org.data!.id, patch);
              qc.invalidateQueries({ queryKey: ["admin.org.smtp", org.data!.id] });
            }}
          />
        </div>
      )}
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
        <p className="text-xs text-slate-500">Shown in the sidebar for your team. PNG, JPG, WEBP, SVG, GIF, or ICO. Max 2 MB.</p>
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
