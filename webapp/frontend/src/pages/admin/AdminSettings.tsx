import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { adminApi } from "@/api";
import { apiError } from "@/api/client";
import { PageHeader, Spinner } from "@/components/ui";
import { SmtpForm } from "@/components/SmtpForm";
import { ALL_COLUMNS, DEFAULT_COLUMNS } from "@/pages/org/OrgDashboard";
import { loadPlatformConfig } from "@/lib/platform";

// Common IANA zones; falls back to Intl.supportedValuesOf when available.
const TIMEZONE_OPTIONS: string[] = (() => {
  const intl = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
  if (intl && intl.length) return intl;
  return [
    "UTC",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Anchorage", "America/Phoenix", "Pacific/Honolulu",
    "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Singapore", "Asia/Kolkata", "Asia/Dubai",
    "Australia/Sydney",
  ];
})();

export default function AdminSettings() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["admin.settings"], queryFn: adminApi.getSettings });

  const [platformName, setPlatformName] = useState("");
  const [defaultSupport, setDefaultSupport] = useState("");
  const [defaultFromEmail, setDefaultFromEmail] = useState("");
  const [defaultFromName, setDefaultFromName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [backendPort, setBackendPort] = useState<number>(8000);

  useEffect(() => {
    if (settings.data) {
      setPlatformName(settings.data.platform_name || "");
      setDefaultSupport(settings.data.default_support_email || "");
      setDefaultFromEmail(settings.data.default_from_email || "");
      setDefaultFromName(settings.data.default_from_name || "");
      setTimezone(settings.data.timezone || "UTC");
      setColumns(settings.data.default_dashboard_columns?.length
        ? settings.data.default_dashboard_columns
        : DEFAULT_COLUMNS);
      setPublicBaseUrl(settings.data.public_base_url || "");
      setBackendPort(settings.data.backend_port ?? 8000);
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => adminApi.updateSettings({
      platform_name: platformName,
      default_support_email: defaultSupport,
      default_from_email: defaultFromEmail,
      default_from_name: defaultFromName,
      timezone,
      default_dashboard_columns: columns,
      public_base_url: publicBaseUrl.trim(),
      backend_port: Number(backendPort) || 8000,
    }),
    onSuccess: () => {
      toast.success("Platform settings saved");
      qc.invalidateQueries({ queryKey: ["admin.settings"] });
      void loadPlatformConfig(true);
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const toggleCol = (key: string) =>
    setColumns((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

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

  const orderedSelected = useMemo(
    () => columns.filter((k) => ALL_COLUMNS.some((c) => c.key === k)),
    [columns],
  );
  const unselected = ALL_COLUMNS.filter((c) => !columns.includes(c.key));

  const nowLocal = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "long",
      }).format(new Date());
    } catch {
      return `${new Date().toISOString()} (invalid TZ)`;
    }
  }, [timezone]);

  if (settings.isLoading) return <Spinner />;

  return (
    <>
      <PageHeader
        title="Platform Settings"
        description="Configure platform-wide defaults and inspect email delivery."
      />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><h3 className="font-semibold">General</h3></div>
          <div className="card-body space-y-3">
            <div>
              <label className="label">Platform name</label>
              <input className="input" value={platformName} onChange={(e) => setPlatformName(e.target.value)} />
              <p className="help">Shown in emails and the admin console.</p>
            </div>
            <div>
              <label className="label">Default support email for new organizations</label>
              <input className="input" type="email" value={defaultSupport} onChange={(e) => setDefaultSupport(e.target.value)} placeholder="support@example.com" />
              <p className="help">Pre-fills the support email when a new organization is created. Existing orgs are not changed.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Default sender email (From)</label>
                <input className="input" type="email" value={defaultFromEmail} onChange={(e) => setDefaultFromEmail(e.target.value)} placeholder="noreply@yourdomain.com" />
              </div>
              <div>
                <label className="label">Default sender name</label>
                <input className="input" value={defaultFromName} onChange={(e) => setDefaultFromName(e.target.value)} placeholder="Employee Onboarding Portal" />
              </div>
            </div>
            <p className="help">Used as the From header on outbound emails when an organization hasn't set its own sender. Pre-fills the sender for newly created organizations. With SMTP2GO, every From address must be a verified sender on your account.</p>
            <div>
              <label className="label">Platform timezone</label>
              <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="help">Used for server-side date math and report rollups. UI timestamps still render in each viewer's local time. Current platform time: <code>{nowLocal}</code>.</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h3 className="font-semibold">Email delivery status</h3></div>
          <div className="card-body space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div className="text-slate-600 dark:text-slate-300">Active SMTP host</div>
              <div className="text-right"><code className="text-xs">{settings.data?.smtp_host || settings.data?.smtp_from || "— dev mode"}</code></div>
              <div className="text-slate-600 dark:text-slate-300">Status</div>
              <div className="text-right">
                <span className={settings.data?.smtp_configured ? "badge-green" : "badge-amber"}>
                  {settings.data?.smtp_configured ? "configured" : "not configured"}
                </span>
              </div>
              <div className="text-slate-600 dark:text-slate-300">Public base URL</div>
              <div className="text-right"><code className="text-xs break-all">{settings.data?.public_base_url || "—"}</code></div>
              <div className="text-slate-600 dark:text-slate-300">Listening on</div>
              <div className="text-right"><code className="text-xs">:{settings.data?.backend_port}</code></div>
            </div>
            <p className="help pt-2">
              SMTP settings below are stored in the database and take precedence over
              <code>.env</code>. Per-organization overrides take precedence over these.
            </p>
          </div>
        </div>

        <div className="card md:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold">Network &amp; ports</h3>
          </div>
          <div className="card-body space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-3">
                <label className="label">Public base URL</label>
                <input className="input" value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://onboarding.example.com" />
                <p className="help">Used in invite, password-reset, and approval emails. Include the scheme (http/https) and any port if non-standard. Takes effect immediately.</p>
              </div>
              <div>
                <label className="label">Listen port</label>
                <input className="input" type="number" min={1} max={65535} value={backendPort} onChange={(e) => setBackendPort(Number(e.target.value))} />
                <p className="help">Single port serves both the API and the web UI.</p>
              </div>
              <div className="md:col-span-2 text-xs text-slate-500 dark:text-slate-400 self-end pb-1">
                <div className="font-semibold text-slate-600 dark:text-slate-300 mb-0.5">Restart required</div>
                <div>Linux: <code>sudo systemctl restart itrequest-backend</code></div>
                <div>Dev: re-run <code>uvicorn</code></div>
              </div>
            </div>
            {settings.data && (
              <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>Runtime config: <code>{settings.data.runtime_env_path}</code></span>
                {!settings.data.runtime_env_writable && (
                  <span className="text-amber-700 dark:text-amber-400">
                    Warning: backend can't write to that path — values won't propagate to systemd.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card md:col-span-2">
          <div className="card-header"><h3 className="font-semibold">Default dashboard columns for new organizations</h3></div>
          <div className="card-body space-y-3">
            <p className="text-sm text-slate-600">Choose the default Recent activity columns applied to newly created organizations. Each org can override these in its own Settings page.</p>

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

            <button type="button" className="btn-ghost text-xs" onClick={() => setColumns(DEFAULT_COLUMNS)}>Reset to built-in defaults</button>
          </div>
        </div>

        {settings.data && (
          <div className="md:col-span-2">
            <SmtpForm
              value={settings.data}
              testScope={{ scope: "platform" }}
              description={
                "Used to relay all platform-wide outbound email (approvals, invites, password resets, support submissions). " +
                "For SMTP2GO use host mail.smtp2go.com, port 587, STARTTLS, and PLAIN auth with your SMTP user. " +
                "Per-organization overrides (configured on each org's detail page) take precedence."
              }
              onSave={async (patch) => {
                await adminApi.updateSettings(patch);
                qc.invalidateQueries({ queryKey: ["admin.settings"] });
              }}
            />
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>

      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <DatabaseBackupCard />
      </div>
    </>
  );
}

function DatabaseBackupCard() {
  const [busy, setBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const download = async () => {
    setBusy(true);
    try {
      const r = await adminApi.downloadBackup();
      const url = URL.createObjectURL(r.data as unknown as Blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = (r.headers as any)["content-disposition"] || "";
      const m = /filename="?([^"]+)"?/.exec(cd);
      a.download = m?.[1] || `itp-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!pendingFile) return;
    if (!window.confirm(
      `Replace the live database with "${pendingFile.name}"?\n\n` +
      "All current data will be overwritten. The current database will be moved aside as a .pre-restore-<timestamp> file. " +
      "After the restore completes, restart the API server."
    )) return;
    setRestoreBusy(true);
    try {
      const r = await adminApi.restoreBackup(pendingFile);
      toast.success(r.message || "Restore complete");
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setRestoreBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header"><h3 className="font-semibold">Database backup</h3></div>
      <div className="card-body space-y-4">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Download a snapshot of the entire SQLite database. Stash it somewhere safe — it contains every organization, user, request, and audit entry.
          </p>
          <div className="mt-2">
            <button className="btn-primary" disabled={busy} onClick={download}>
              {busy ? "Exporting…" : "Download backup (.sqlite)"}
            </button>
          </div>
        </div>
        <div className="border-t border-slate-100 dark:border-slate-700 pt-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Restore from a previously downloaded backup. <strong>This overwrites the live database.</strong>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".sqlite,.db,application/octet-stream"
            className="mt-2 block text-sm text-slate-700 dark:text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 dark:file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 dark:file:text-slate-100 hover:file:bg-slate-200 dark:hover:file:bg-slate-600"
            onChange={(e) => setPendingFile(e.target.files?.[0] || null)}
          />
          <div className="mt-2">
            <button className="btn-danger" disabled={!pendingFile || restoreBusy} onClick={restore}>
              {restoreBusy ? "Restoring…" : "Restore from backup"}
            </button>
          </div>
          <p className="help mt-2">
            After a restore, restart the API process so connection pools reload cleanly.
          </p>
        </div>
      </div>
    </div>
  );
}
