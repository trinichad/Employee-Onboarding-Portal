import { useId, useState } from "react";
import toast from "react-hot-toast";
import { meApi } from "@/api";
import { apiError } from "@/api/client";
import type { TotpSetupData, User } from "@/types";

interface Props {
  user: User;
  onChange: () => void | Promise<void>;
  /** When true, the user's role mandates 2FA — hide the disable option. */
  required: boolean;
}

type Mode = "idle" | "setup" | "reenroll-password" | "disable-password";

export function TwoFactorCard({ user, onChange, required }: Props) {
  const uid = useId();
  const enrolled = !!user.totp_enrolled;
  const [mode, setMode] = useState<Mode>("idle");
  const [data, setData] = useState<TotpSetupData | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const reset = () => {
    setMode("idle"); setData(null); setCode(""); setPw(""); setShowSecret(false);
  };

  const beginSetup = async () => {
    setBusy(true);
    try {
      const d = await meApi.totpSetup();
      setData(d);
      setMode("setup");
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const beginReenroll = async () => {
    setBusy(true);
    try {
      const d = await meApi.totpReenroll(pw);
      setData(d);
      setMode("setup");
      setPw("");
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const confirmEnroll = async () => {
    setBusy(true);
    try {
      await meApi.totpEnroll(code);
      toast.success(enrolled ? "New device registered" : "Two-factor authentication enabled");
      reset();
      await onChange();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const cancelSetup = async () => {
    try { await meApi.totpCancelSetup(); } catch { /* ignore */ }
    reset();
  };

  const confirmDisable = async () => {
    setBusy(true);
    try {
      await meApi.totpDisable(pw);
      toast.success("Two-factor authentication disabled");
      reset();
      await onChange();
    } catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h3 className="font-semibold">Two-factor authentication</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${enrolled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
          {enrolled ? "Enabled" : "Not enabled"}
        </span>
      </div>
      <div className="card-body space-y-3">
        {required && (
          <p className="text-xs text-slate-500">
            Two-factor authentication is required for your role and cannot be turned off. You can register a new authenticator device at any time.
          </p>
        )}

        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            {!enrolled && (
              <button className="btn-primary" disabled={busy} onClick={beginSetup}>
                {busy ? "Loading…" : "Set up authenticator app"}
              </button>
            )}
            {enrolled && (
              <button className="btn-secondary" onClick={() => setMode("reenroll-password")}>
                Register a new device
              </button>
            )}
            {enrolled && !required && (
              <button className="btn-danger" onClick={() => setMode("disable-password")}>
                Disable 2FA
              </button>
            )}
          </div>
        )}

        {mode === "reenroll-password" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Confirm your password to register a new authenticator. Your existing device keeps working until you confirm a code from the new one.
            </p>
            <div>
              <label className="label" htmlFor={`${uid}-reenroll-pw`}>Current password</label>
              <input id={`${uid}-reenroll-pw`} name="current-password" autoComplete="current-password" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={reset}>Cancel</button>
              <button className="btn-primary" disabled={!pw || busy} onClick={beginReenroll}>
                {busy ? "Verifying…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {mode === "setup" && data && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Scan this QR code with an authenticator app, then enter the 6-digit code it generates.
            </p>
            <div className="flex justify-center">
              <img src={data.qr_png_base64} alt="2FA QR code" className="h-44 w-44 rounded border bg-white p-2" />
            </div>
            <div>
              <button type="button" className="text-xs text-brand-600 hover:underline"
                onClick={() => setShowSecret(s => !s)}>
                {showSecret ? "Hide manual entry key" : "Can't scan? Show manual entry key"}
              </button>
              {showSecret && (
                <div className="mt-1 rounded bg-slate-50 border p-2 text-center font-mono text-sm select-all break-all">
                  {data.secret}
                </div>
              )}
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-totp-code`}>6-digit code</label>
              <input
                id={`${uid}-totp-code`}
                className="input tracking-[0.4em] text-center"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D+/g, ""))}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" disabled={busy} onClick={cancelSetup}>Cancel</button>
              <button className="btn-primary" disabled={code.length < 6 || busy} onClick={confirmEnroll}>
                {busy ? "Verifying…" : "Verify and save"}
              </button>
            </div>
          </div>
        )}

        {mode === "disable-password" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Enter your current password to disable two-factor authentication.
            </p>
            <div>
              <label className="label" htmlFor={`${uid}-disable-pw`}>Current password</label>
              <input id={`${uid}-disable-pw`} name="current-password" autoComplete="current-password" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </div>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={reset}>Cancel</button>
              <button className="btn-danger" disabled={!pw || busy} onClick={confirmDisable}>
                {busy ? "Disabling…" : "Disable 2FA"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
