import { useState } from "react";
import toast from "react-hot-toast";
import { meApi } from "@/api";
import { apiError } from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { PageHeader } from "@/components/ui";
import { TwoFactorCard } from "@/components/TwoFactorCard";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function OrgProfile() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState(user?.full_name || "");
  const [busy, setBusy] = useState(false);
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const saveName = async () => {
    setBusy(true);
    try { await meApi.updateProfile(name); toast.success("Profile updated"); await refresh(); }
    catch (e) { toast.error(apiError(e)); }
    finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (pwNew.length < 8) { toast.error("Min 8 characters"); return; }
    setPwBusy(true);
    try { await meApi.changePassword(pwCur, pwNew); toast.success("Password changed"); setPwCur(""); setPwNew(""); }
    catch (e) { toast.error(apiError(e)); }
    finally { setPwBusy(false); }
  };

  return (
    <>
      <PageHeader title="My Profile" />
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header"><h3 className="font-semibold">Profile</h3></div>
          <div className="card-body space-y-3">
            <div><label className="label" htmlFor="orgprof-email">Email</label><input id="orgprof-email" className="input" value={user?.email || ""} disabled /></div>
            <div><label className="label" htmlFor="orgprof-fullname">Full name</label><input id="orgprof-fullname" name="name" autoComplete="name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><label className="label" htmlFor="orgprof-role">Role</label><input id="orgprof-role" className="input" value={user?.role} disabled /></div>
            <div className="flex justify-end"><button className="btn-primary" disabled={busy} onClick={saveName}>{busy ? "Saving…" : "Save"}</button></div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3 className="font-semibold">Change password</h3></div>
          <div className="card-body space-y-3">
            <div><label className="label" htmlFor="orgprof-cur-pw">Current password</label>
              <input id="orgprof-cur-pw" name="current-password" autoComplete="current-password" className="input" type="password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} /></div>
            <div><label className="label" htmlFor="orgprof-new-pw">New password</label>
              <input id="orgprof-new-pw" name="new-password" autoComplete="new-password" className="input" type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} /></div>
            <div className="flex justify-end"><button className="btn-primary" disabled={!pwCur || !pwNew || pwBusy} onClick={changePassword}>{pwBusy ? "Updating…" : "Update password"}</button></div>
          </div>
        </div>
        {user && (
          <div className="md:col-span-2">
            <TwoFactorCard
              user={user}
              required={user.role === "client_admin" || user.role === "global_admin"}
              onChange={refresh}
            />
          </div>
        )}
        <div className="card md:col-span-2">
          <div className="card-header"><h3 className="font-semibold">Appearance</h3></div>
          <div className="card-body">
            <label className="label">Theme</label>
            <ThemeToggle />
            <p className="help">Saved to your account.</p>
          </div>
        </div>
      </div>
    </>
  );
}
