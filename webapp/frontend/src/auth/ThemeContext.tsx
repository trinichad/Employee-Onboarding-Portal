import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { meApi } from "@/api";

export type ThemePref = "light" | "dark" | "system";

interface ThemeCtx {
  theme: ThemePref;        // user preference
  effective: "light" | "dark"; // actual mode currently applied (only relevant inside app layouts)
  setTheme: (t: ThemePref) => Promise<void>;
  /** Internal: increments while a layout is mounted that wants dark applied. */
  _bumpActive: (delta: 1 | -1) => void;
}

const Ctx = createContext<ThemeCtx | undefined>(undefined);

function resolveEffective(t: ThemePref): "light" | "dark" {
  if (t === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return t;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, setUser } = useAuth();
  const pref = (user?.theme as ThemePref | undefined) || "light";
  const [theme, setThemeState] = useState<ThemePref>(pref);
  const [effective, setEffective] = useState<"light" | "dark">(resolveEffective(pref));
  const [active, setActive] = useState(0); // # of mounted layouts that want dark applied

  // Sync from user.theme whenever it changes.
  useEffect(() => {
    const next = (user?.theme as ThemePref | undefined) || "light";
    setThemeState(next);
    setEffective(resolveEffective(next));
  }, [user?.theme]);

  // React to OS theme changes when set to "system" and a layout is active.
  useEffect(() => {
    if (theme !== "system" || active === 0) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const eff = mq.matches ? "dark" : "light";
      setEffective(eff);
      document.documentElement.classList.toggle("dark", eff === "dark");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme, active]);

  // Reflect the current effective mode on <html> only while a layout is active.
  useEffect(() => {
    if (active > 0) {
      document.documentElement.classList.toggle("dark", effective === "dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [effective, active]);

  const _bumpActive = useCallback((delta: 1 | -1) => {
    setActive((n) => Math.max(0, n + delta));
  }, []);

  const setTheme = useCallback(async (t: ThemePref) => {
    setThemeState(t);
    setEffective(resolveEffective(t));
    if (user) {
      try {
        const updated = await meApi.updateProfile2({ theme: t });
        setUser(updated);
      } catch {
        // Non-fatal: keep local pref even if save fails.
      }
    }
  }, [user, setUser]);

  const value = useMemo<ThemeCtx>(
    () => ({ theme, effective, setTheme, _bumpActive }),
    [theme, effective, setTheme, _bumpActive]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme must be used within ThemeProvider");
  return v;
}

/** Mount inside a layout to actually apply the user's theme to <html>. */
export function useApplyTheme() {
  const { _bumpActive } = useTheme();
  useEffect(() => {
    _bumpActive(1);
    return () => _bumpActive(-1);
  }, [_bumpActive]);
}
