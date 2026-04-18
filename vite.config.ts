import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

function getBuildTimestamp(): string {
  try {
    // Last commit's committer date in YYYYMMDDHHmmss format.
    return execSync("git log -1 --format=%cd --date=format:%Y%m%d%H%M%S", {
      encoding: "utf8",
    }).trim();
  } catch {
    return new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
  }
}

// Tauri-friendly Vite config.
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(getBuildTimestamp()),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    sourcemap: true,
  },
}));
