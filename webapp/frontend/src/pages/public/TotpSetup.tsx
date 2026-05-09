import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import type { TotpSetupData } from "@/types";
import { AuthShell } from "./AdminLogin";

type LocState = { challenge?: string; returnTo?: string; scope?: "admin" | "org"; orgSlug?: string };

export default function TotpSetup() {
  const nav = useNavigate();
  const loc = useLocation();
  const { finishLoginWithTokens } = useAuth();
  const state = (loc.state || {}) as LocState;
  const [data, setData] = useState<TotpSetupData | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (!state.challenge) {
      toast.error("Sign in again — your setup session expired.");
      nav(state.scope === "org" && state.orgSlug ? `/${state.orgSlug}/login` : "/admin/login", { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const d = await authApi.totpSetupFromChallenge(state.challenge!);
        if (!cancelled) setData(d);
      } catch (e) {
        toast.error(apiError(e, "Could not start 2FA setup"));
      }
    })();
    return () => { cancelled = true; };
  }, [state, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.challenge) return;
    setBusy(true);
    try {
      const tok = await authApi.totpEnrollFromChallenge(state.challenge, code);
      await finishLoginWithTokens(tok.access_token, tok.refresh_token);
      toast.success("Two-factor authentication enabled");
      nav(state.returnTo || "/", { replace: true });
    } catch (e) {
      toast.error(apiError(e, "Invalid code"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Set up two-factor authentication"
      subtitle="Required for administrator accounts. Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy, etc.)"
    >
      {!data ? (
        <div className="text-center text-sm text-slate-500 py-8">Generating secret…</div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="flex justify-center">
            <img src={data.qr_png_base64} alt="2FA QR code" className="h-48 w-48 rounded border bg-white p-2" />
          </div>
          <div>
            <button
              type="button"
              onClick={() => setShowSecret(s => !s)}
              className="text-xs text-brand-600 hover:underline"
            >
              {showSecret ? "Hide manual entry key" : "Can't scan? Show manual entry key"}
            </button>
            {showSecret && (
              <div className="mt-2 rounded bg-slate-50 border p-2 text-center font-mono text-sm select-all break-all">
                {data.secret}
              </div>
            )}
          </div>
          <div>
            <label className="label">Enter the 6-digit code from your app</label>
            <input
              className="input tracking-[0.4em] text-center text-lg"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D+/g, ""))}
            />
          </div>
          <button className="btn-primary w-full" disabled={busy || code.length < 6}>
            {busy ? "Verifying…" : "Verify and enable"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
