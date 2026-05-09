import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AuthShell } from "./AdminLogin";

export default function AdminSetup() {
  const nav = useNavigate();
  const { finishLoginWithTokens } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords don't match"); return; }
    setBusy(true);
    try {
      const tokens = await authApi.bootstrap(email, password, fullName.trim() || undefined);
      await finishLoginWithTokens(tokens.access_token, tokens.refresh_token);
      toast.success("Welcome — your platform is ready.");
      nav("/admin", { replace: true });
    } catch (e) {
      toast.error(apiError(e, "Setup failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome — first-run setup" subtitle="Create your platform admin account">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This account has full control over the platform: organizations, users,
          and settings. You can change everything later.
        </p>
        <div>
          <label className="label">Your name</label>
          <input className="input" autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Platform Admin" />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input className="input" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </AuthShell>
  );
}
