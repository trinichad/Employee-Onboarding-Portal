import { useId, useState } from "react";
import toast from "react-hot-toast";
import { adminApi } from "@/api";
import { apiError } from "@/api/client";
import type { SmtpConfig, SmtpConfigUpdate } from "@/types";

const SECURITY_OPTIONS: { value: string; label: string }[] = [
  { value: "starttls", label: "STARTTLS (587)" },
  { value: "ssl", label: "SSL/TLS (465)" },
  { value: "none", label: "None (25 / 2525, plaintext)" },
  { value: "http_api", label: "HTTP API (SMTP2GO) — recommended" },
];

const AUTH_OPTIONS: { value: string; label: string }[] = [
  { value: "auto", label: "Auto (smtplib negotiates)" },
  { value: "plain", label: "PLAIN — username/password (SMTP2GO)" },
  { value: "login", label: "LOGIN — username/password" },
  { value: "cram_md5", label: "CRAM-MD5" },
  { value: "none", label: "No authentication" },
];

export interface SmtpFormProps {
  /** Current saved value loaded from the server. */
  value: SmtpConfig;
  /** Persist changes — caller decides whether to PATCH platform or org. */
  onSave: (patch: SmtpConfigUpdate) => Promise<unknown>;
  /** Test scope for the "Send test connection" button. */
  testScope: { scope: "platform" | "org"; orgId?: number };
  /** Help text to display under the heading. */
  description?: string;
  /** Optional sub-title rendered next to "SMTP server" */
  badge?: React.ReactNode;
}

export function SmtpForm({ value, onSave, testScope, description, badge }: SmtpFormProps) {
  const uid = useId();
  const [host, setHost] = useState(value.smtp_host || "");
  const [port, setPort] = useState<number | "">(value.smtp_port || "");
  const [security, setSecurity] = useState(value.smtp_security || "starttls");
  const [auth, setAuth] = useState(value.smtp_auth || "auto");
  const [username, setUsername] = useState(value.smtp_username || "");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const buildPatch = (): SmtpConfigUpdate => {
    const patch: SmtpConfigUpdate = {
      smtp_host: host.trim(),
      smtp_port: typeof port === "number" ? port : Number(port) || 0,
      smtp_security: security,
      smtp_auth: auth,
      smtp_username: username.trim(),
    };
    if (clearPassword) patch.smtp_password = "";
    else if (password) patch.smtp_password = password;
    return patch;
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(buildPatch());
      setPassword("");
      setClearPassword(false);
      toast.success("SMTP settings saved");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await adminApi.testSmtp(testScope.scope, testScope.orgId, testTo.trim() || undefined);
      if (!r.usable) {
        toast.error("No SMTP host saved — fill in the form and click Save first.");
      } else if (!r.ok) {
        toast.error(`SMTP failed: ${r.message}`);
      } else if (testTo.trim()) {
        if (r.sent) toast.success(`SMTP OK — ${r.send_message}`);
        else toast.error(`Connected, but ${r.send_message}`);
      } else {
        toast.success(`SMTP OK: ${r.message}`);
      }
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-semibold">SMTP server {badge}</h3>
      </div>
      <div className="card-body space-y-4">
        {description && <p className="text-sm text-slate-600">{description}</p>}

        <div>
          <label className="label" htmlFor={`${uid}-transport`}>Transport</label>
          <select id={`${uid}-transport`} className="input" value={security} onChange={(e) => setSecurity(e.target.value)}>
            {SECURITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {security === "http_api" && (
            <p className="help">
              Sends through SMTP2GO's HTTPS API instead of SMTP. Bypasses port/auth issues —
              just paste your SMTP2GO API key below. Get one at SMTP2GO → Settings → API Keys.
            </p>
          )}
        </div>

        {security !== "http_api" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="label" htmlFor={`${uid}-host`}>Host</label>
                <input id={`${uid}-host`} className="input" value={host} onChange={(e) => setHost(e.target.value)}
                       placeholder="mail.smtp2go.com" />
              </div>
              <div>
                <label className="label" htmlFor={`${uid}-port`}>Port</label>
                <input id={`${uid}-port`} className="input" type="number" min={0} max={65535}
                       value={port}
                       onChange={(e) => setPort(e.target.value === "" ? "" : Number(e.target.value))}
                       placeholder={security === "ssl" ? "465" : security === "starttls" ? "587" : "2525"} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor={`${uid}-auth`}>Authentication method</label>
              <select id={`${uid}-auth`} className="input" value={auth} onChange={(e) => setAuth(e.target.value)}>
                {AUTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </>
        )}

        {security !== "http_api" && auth !== "none" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`${uid}-username`}>Username</label>
              <input id={`${uid}-username`} className="input" autoComplete="off" value={username}
                     onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-password`}>
                Password{value.smtp_password_set ? " (saved — leave blank to keep)" : ""}
              </label>
              <input id={`${uid}-password`} className="input" type="password" autoComplete="new-password"
                     value={password} onChange={(e) => setPassword(e.target.value)}
                     placeholder={value.smtp_password_set ? "•••••••• (unchanged)" : ""} />
              {value.smtp_password_set && (
                <label className="mt-1 inline-flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={clearPassword}
                         onChange={(e) => setClearPassword(e.target.checked)} />
                  Clear stored password
                </label>
              )}
            </div>
          </div>
        )}

        {security === "http_api" && (
          <div>
            <label className="label" htmlFor={`${uid}-apikey`}>
              SMTP2GO API key{value.smtp_password_set ? " (saved — leave blank to keep)" : ""}
            </label>
            <input id={`${uid}-apikey`} className="input" type="password" autoComplete="new-password"
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   placeholder={value.smtp_password_set ? "•••••••• (unchanged)" : "api-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"} />
            {value.smtp_password_set && (
              <label className="mt-1 inline-flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={clearPassword}
                       onChange={(e) => setClearPassword(e.target.checked)} />
                Clear stored API key
              </label>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 pt-2">
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save SMTP settings"}
          </button>
          <div className="flex items-end gap-2">
            <div>
              <label className="label" htmlFor={`${uid}-testto`}>Send test email to (optional)</label>
              <input id={`${uid}-testto`} className="input" type="email" value={testTo}
                     onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            </div>
            <button type="button" className="btn-secondary h-10" disabled={testing} onClick={test}
                    title="Tests the saved configuration. Save first if you've made changes.">
              {testing ? "Testing…" : testTo ? "Send test email" : "Test connection"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
