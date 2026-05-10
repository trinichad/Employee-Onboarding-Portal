import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError } from "@/api/client";
import { setTokens } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AuthShell } from "./AdminLogin";

interface OrgChoice { slug: string; name: string }

export default function EmployeeLogin() {
  const { refresh, user, loading } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<OrgChoice[] | null>(null);
  const [chosenSlug, setChosenSlug] = useState("");

  // Already authenticated: skip the login form and go to the appropriate portal.
  useEffect(() => {
    if (loading || !user) return;
    if (user.organization_slug) {
      nav(`/${user.organization_slug}`, { replace: true });
    } else if (user.role === "global_admin") {
      nav("/admin", { replace: true });
    }
  }, [loading, user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await authApi.employeeLogin(email, password, chosenSlug || undefined);
      if ("totp_required" in res && res.totp_required) {
        const slug = res.organization?.slug;
        nav("/login/totp", { state: { challenge: res.challenge, returnTo: slug ? `/${slug}` : "/", scope: "org", orgSlug: slug } });
        return;
      }
      if ("totp_setup_required" in res && res.totp_setup_required) {
        const slug = res.organization?.slug;
        nav("/login/totp-setup", { state: { challenge: res.challenge, returnTo: slug ? `/${slug}` : "/", scope: "org", orgSlug: slug } });
        return;
      }
      setTokens(res.access_token, res.refresh_token);
      await refresh();
      const slug = res.organization?.slug;
      if (slug) nav(`/${slug}`);
      else nav("/");
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 409 && detail && Array.isArray(detail.organizations)) {
        setChoices(detail.organizations);
        toast("Select your organization to continue.");
      } else {
        toast.error(apiError(err, "Invalid credentials"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Employee Onboarding Portal">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); setChoices(null); setChosenSlug(""); }}
          />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {choices && choices.length > 1 && (
          <div>
            <label className="label">Organization</label>
            <select
              className="input"
              value={chosenSlug}
              onChange={(e) => setChosenSlug(e.target.value)}
              required
            >
              <option value="">Select an organization…</option>
              {choices.map((o) => (
                <option key={o.slug} value={o.slug}>{o.name}</option>
              ))}
            </select>
            <p className="help mt-1">Multiple organizations use this email. Pick one to continue.</p>
          </div>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy || (choices !== null && !chosenSlug)}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-slate-500">
          Are you a platform administrator?{" "}
          <Link className="text-brand-600 hover:underline" to="/admin/login">Admin sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
