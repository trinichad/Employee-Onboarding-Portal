import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs";

// Read webapp/runtime.env (written by the admin UI) so dev/preview honor the
// configured ports without manual flags. Falls back to defaults if absent.
function readRuntimeEnv(): Record<string, string> {
  const file = path.resolve(__dirname, "..", "runtime.env");
  const out: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
    }
  } catch {
    /* file missing — defaults below */
  }
  return out;
}

const runtime = readRuntimeEnv();
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || runtime.FRONTEND_PORT || 5173);
const BACKEND_PORT = Number(process.env.BACKEND_PORT || runtime.BACKEND_PORT || 8000);

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: true, // listen on 0.0.0.0 so phones on LAN can connect
    port: FRONTEND_PORT,
    strictPort: false,
    proxy: {
      "/api": `http://localhost:${BACKEND_PORT}`,
    },
  },
  preview: {
    host: true,
    port: FRONTEND_PORT,
  },
});
