import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "@/auth/AuthContext";
import { apiError } from "@/api/client";
import { AuthShell } from "./AdminLogin";

export default function OrgLogin() {
  const { orgSlug = "" } = useParams();
  const { login, user, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Already authenticated: send the user to a portal they can access.
  useEffect(() => {
    if (loading || !user) return;
    if (user.role === "global_admin") {
      nav(`/${orgSlug}`, { replace: true });
    } else if (user.organization_slug === orgSlug) {
      nav(`/${orgSlug}`, { replace: true });
    } else if (user.organization_slug) {
      nav(`/${user.organization_slug}`, { replace: true });
    }
  }, [loading, user, orgSlug, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(email, password, orgSlug);
      if (result.kind === "totp") {
        nav(result.mode === "setup" ? "/login/totp-setup" : "/login/totp", {
          state: { challenge: result.challenge, returnTo: `/${orgSlug}`, scope: "org", orgSlug },
        });
        return;
      }
      nav(`/${orgSlug}`);
    } catch (e) {
      toast.error(apiError(e, "Invalid credentials"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={`Sign in`} subtitle={`Organization: ${orgSlug}`}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="org-email">Email</label>
          <input id="org-email" name="email" autoComplete="email" className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="org-password">Password</label>
          <input id="org-password" name="password" autoComplete="current-password" className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <div className="text-center text-xs text-slate-500">
          <Link className="text-brand-600 hover:underline" to={`/${orgSlug}/forgot`}>Forgot password?</Link>
        </div>
      </form>
    </AuthShell>
  );
}
