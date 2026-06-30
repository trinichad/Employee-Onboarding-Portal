import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError } from "@/api/client";
import { AuthShell } from "./AdminLogin";

export default function ForgotPassword() {
  const { orgSlug } = useParams();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authApi.forgot(email, orgSlug);
      setDone(true);
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Reset your password" subtitle={orgSlug}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">If an account with that email exists, a reset link has been sent.</p>
          <Link to={orgSlug ? `/${orgSlug}/login` : "/admin/login"} className="btn-secondary w-full">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="forgot-email">Email</label>
            <input id="forgot-email" name="email" autoComplete="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
    </AuthShell>
  );
}
