import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "@/auth/AuthContext";
import { apiError } from "@/api/client";

export default function AdminLogin() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result.kind === "totp") {
        nav(result.mode === "setup" ? "/login/totp-setup" : "/login/totp", {
          state: { challenge: result.challenge, returnTo: "/admin", scope: "admin" },
        });
        return;
      }
      if (result.user.role !== "global_admin") {
        toast.error("This sign-in is for Global Admins only.");
        return;
      }
      nav("/admin");
    } catch (e) {
      toast.error(apiError(e, "Invalid credentials"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Global Admin Sign in" subtitle="Platform administration console">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-center text-xs text-slate-500">
          Looking for an organization portal? <Link className="text-brand-600 hover:underline" to="/login">Sign in here</Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-50 to-brand-50">
      <div className="w-full max-w-md card">
        <div className="card-body">
          <div className="flex items-center gap-2 mb-6">
            <div className="h-9 w-9 rounded-lg bg-brand-600 text-white grid place-items-center font-semibold">ER</div>
            <div>
              <div className="text-base font-semibold">{title}</div>
              {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
