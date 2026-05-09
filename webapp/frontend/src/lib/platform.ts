import { useEffect, useState } from "react";
import { api } from "@/api/client";

export interface PublicConfig {
  platform_name: string;
  timezone: string;
}

const DEFAULT_CONFIG: PublicConfig = { platform_name: "Employee Onboarding Portal", timezone: "UTC" };

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
  for (const fn of _listeners) fn(_cache);
  return _cache;
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
