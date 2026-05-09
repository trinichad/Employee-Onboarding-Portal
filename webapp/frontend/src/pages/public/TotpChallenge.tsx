import { useEffect, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AuthShell } from "./AdminLogin";

type LocState = { challenge?: string; returnTo?: string; scope?: "admin" | "org"; orgSlug?: string };

export default function TotpChallenge() {
  const nav = useNavigate();
  const loc = useLocation();
  const { finishLoginWithTokens } = useAuth();
  const state = (loc.state || {}) as LocState;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.challenge) {
      toast.error("Sign in again — your verification session expired.");
      nav(state.scope === "org" && state.orgSlug ? `/${state.orgSlug}/login` : "/admin/login", { replace: true });
    }
  }, [state, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.challenge) return;
    setBusy(true);
    try {
      const tok = await authApi.totpVerify(state.challenge, code);
      await finishLoginWithTokens(tok.access_token, tok.refresh_token);
      nav(state.returnTo || "/", { replace: true });
    } catch (e) {
      toast.error(apiError(e, "Invalid code"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Two-factor verification" subtitle="Enter the 6-digit code from your authenticator app">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Authentication code</label>
          <input
            className="input tracking-[0.4em] text-center text-lg"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D+/g, ""))}
          />
        </div>
        <button className="btn-primary w-full" disabled={busy || code.length < 6}>
          {busy ? "Verifying…" : "Verify"}
        </button>
        <p className="text-center text-xs text-slate-500">
          Lost your device? Contact your administrator to reset 2FA, or{" "}
          <Link className="text-brand-600 hover:underline" to={state.scope === "org" && state.orgSlug ? `/${state.orgSlug}/login` : "/admin/login"}>
            return to sign-in
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
