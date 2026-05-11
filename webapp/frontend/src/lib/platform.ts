import { useEffect, useState } from "react";
import { api } from "@/api/client";

export interface PublicConfig {
  platform_name: string;
  timezone: string;
  logo_url?: string | null;
}

const DEFAULT_CONFIG: PublicConfig = { platform_name: "Employee Onboarding Portal", timezone: "UTC", logo_url: null };

let _cache: PublicConfig = DEFAULT_CONFIG;
let _loaded = false;
const _listeners = new Set<(c: PublicConfig) => void>();

export function getPlatformConfig(): PublicConfig {
  return _cache;
}

export async function loadPlatformConfig(force = false): Promise<PublicConfig> {
  if (_loaded && !force) return _cache;
  try {
    const r = await api.get<PublicConfig>("/config");
    _cache = { ...DEFAULT_CONFIG, ...r.data };
  } catch {
    _cache = DEFAULT_CONFIG;
  }
  _loaded = true;
  applyFavicon(_cache.logo_url);
  applyDocumentTitle(_cache.platform_name);
  for (const fn of _listeners) fn(_cache);
  return _cache;
}

/** Point the document <link rel="icon"> at the platform logo when present.
 *  When cleared, restores the built-in vite icon. */
function applyFavicon(url: string | null | undefined): void {
  if (typeof document === "undefined") return;
  // Cache-bust so an updated logo replaces the previously-cached favicon.
  const href = url ? `${url}?t=${Date.now()}` : "/vite.svg";
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

function applyDocumentTitle(name: string): void {
  if (typeof document !== "undefined" && name) document.title = name;
}

export function usePlatformConfig(): PublicConfig {
  const [cfg, setCfg] = useState(_cache);
  useEffect(() => {
    if (!_loaded) loadPlatformConfig();
    const fn = (c: PublicConfig) => setCfg(c);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return cfg;
}

function safeTz(tz: string): string {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Format an ISO date/time string in the platform timezone. */
export function formatDateTime(input: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: safeTz(_cache.timezone),
    dateStyle: "short",
    timeStyle: "short",
    ...opts,
  }).format(d);
}

/** Format a date (no time) in the platform timezone. */
export function formatDate(input: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: safeTz(_cache.timezone),
    dateStyle: "medium",
    ...opts,
  }).format(d);
}
