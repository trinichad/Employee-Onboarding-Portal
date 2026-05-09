import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError } from "@/api/client";
import { AuthShell } from "./AdminLogin";

export default function ResetPassword() {
  const { orgSlug } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { toast.error("Passwords don't match"); return; }
    if (pw.length < 8) { toast.error("Min 8 characters"); return; }
    setBusy(true);
    try {
      await authApi.reset(token, pw);
      toast.success("Password updated. Please sign in.");
      nav(orgSlug ? `/${orgSlug}/login` : "/admin/login");
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Choose a new password">
      {!token ? (
        <p className="text-sm text-red-600">Invalid reset link.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div><label className="label">New password</label>
            <input className="input" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label className="label">Confirm password</label>
            <input className="input" type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
          <div className="text-center text-xs"><Link className="text-brand-600 hover:underline" to={orgSlug ? `/${orgSlug}/login` : "/admin/login"}>Back to sign in</Link></div>
        </form>
      )}
    </AuthShell>
  );
}
