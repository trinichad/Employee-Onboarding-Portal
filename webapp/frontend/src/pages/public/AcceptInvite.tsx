import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "@/api";
import { apiError, setTokens } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { AuthShell } from "./AdminLogin";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [info, setInfo] = useState<{ email: string; role: string; organization: { slug: string; name: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const { refresh } = useAuth();

  useEffect(() => {
    if (!token) return;
    authApi.inviteLookup(token).then(setInfo).catch((e) => setError(apiError(e)));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { toast.error("Passwords don't match"); return; }
    if (pw.length < 8) { toast.error("Min 8 characters"); return; }
    setBusy(true);
    try {
      const tok = await authApi.inviteAccept(token, name, pw);
      setTokens(tok.access_token, tok.refresh_token);
      await refresh();
      toast.success("Welcome aboard!");
      nav(info?.organization ? `/${info.organization.slug}` : "/admin");
    } catch (e) {
      toast.error(apiError(e));
    } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Accept invitation" subtitle={info?.organization?.name}>
      {!token || error ? (
        <p className="text-sm text-red-600">{error || "Invalid invite link."}</p>
      ) : !info ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="text-sm text-slate-600">Setting up <b>{info.email}</b> as <b>{info.role.replace("_", " ")}</b>.</div>
          <div><label className="label">Full name</label>
            <input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">Password</label>
            <input className="input" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
          <div><label className="label">Confirm password</label>
            <input className="input" type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Activating…" : "Activate account"}</button>
        </form>
      )}
    </AuthShell>
  );
}
