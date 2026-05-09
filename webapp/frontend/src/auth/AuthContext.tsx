import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { authApi } from "@/api";
import { clearTokens, setTokens } from "@/api/client";
import type { User } from "@/types";

export type LoginResult =
  | { kind: "ok"; user: User }
  | { kind: "totp"; mode: "verify" | "setup"; challenge: string };

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, org_slug?: string) => Promise<LoginResult>;
  finishLoginWithTokens: (access_token: string, refresh_token: string) => Promise<User>;
  logout: () => void;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const u = await authApi.me();
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Re-sync auth when another tab logs in/out (storage event from client.ts).
  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener("itp:auth-changed", handler);
    return () => window.removeEventListener("itp:auth-changed", handler);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, org_slug?: string): Promise<LoginResult> => {
    const resp = await authApi.login(email, password, org_slug);
    if ("totp_required" in resp && resp.totp_required) {
      return { kind: "totp", mode: "verify", challenge: resp.challenge };
    }
    if ("totp_setup_required" in resp && resp.totp_setup_required) {
      return { kind: "totp", mode: "setup", challenge: resp.challenge };
    }
    setTokens(resp.access_token, resp.refresh_token);
    const me = await authApi.me();
    setUser(me);
    return { kind: "ok", user: me };
  }, []);

  const finishLoginWithTokens = useCallback(async (access_token: string, refresh_token: string) => {
    setTokens(access_token, refresh_token);
    const me = await authApi.me();
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, finishLoginWithTokens, logout, refresh, setUser }), [user, loading, login, finishLoginWithTokens, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
