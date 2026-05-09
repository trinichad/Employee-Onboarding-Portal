import axios, { AxiosError } from "axios";

const API_BASE = "/api/v1";

export const api = axios.create({ baseURL: API_BASE });

const ACCESS_KEY = "itp.access";
const REFRESH_KEY = "itp.refresh";

export function getAccessToken() { return localStorage.getItem(ACCESS_KEY); }
export function getRefreshToken() { return localStorage.getItem(REFRESH_KEY); }
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

api.interceptors.request.use((cfg) => {
  const t = getAccessToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// Cross-tab sync: when another tab logs in/out, mirror it here.
window.addEventListener("storage", (e) => {
  if (e.key === ACCESS_KEY || e.key === REFRESH_KEY) {
    // Trigger a soft reload of auth state by dispatching a custom event
    window.dispatchEvent(new Event("itp:auth-changed"));
  }
});

let refreshing: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const res = await axios.post(`${API_BASE}/auth/refresh`, { refresh_token: refresh });
    setTokens(res.data.access_token, res.data.refresh_token);
    return res.data.access_token as string;
  } catch (err) {
    const ax = err as AxiosError;
    // Only clear tokens if the refresh token itself was rejected.
    // Transient network/server errors should NOT log the user out.
    const status = ax?.response?.status;
    if (status === 400 || status === 401 || status === 403) {
      clearTokens();
    }
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original: any = error.config;
    if (error.response?.status === 401 && !original?._retry && original?.url !== "/auth/refresh") {
      original._retry = true;
      refreshing ||= refreshAccessToken().finally(() => { refreshing = null; });
      const newToken = await refreshing;
      if (newToken) {
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  }
);

export function apiError(e: unknown, fallback = "Something went wrong"): string {
  const ax = e as AxiosError<any>;
  return ax?.response?.data?.detail || ax?.message || fallback;
}
