import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: true, // listen on 0.0.0.0 so phones on LAN can connect
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000"
    }
  }
});
