import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

// #120 — MSI-compatible version string: YY.M.DAYMIN where
//   YY     = year - 2000
//   M      = month (1-12)
//   DAYMIN = (day-1)*1440 + hour*60 + minute
// Fits Windows MSI limits (0-255 . 0-255 . 0-65535). Kept in sync with
// scripts/versionFromGit.mjs's encodeCalendarVersion.
function calendarVersion(ts: string): string {
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  const yy = year - 2000;
  const daymin = (day - 1) * 1440 + hour * 60 + minute;
  return `${yy}.${month}.${daymin}`;
}

function getGitInfo(): string {
  try {
    const timestamp = execSync("git log -1 --format=%cd --date=format:%Y%m%d%H%M%S", {
      encoding: "utf8",
    }).trim();
    const commitHash = execSync("git log -1 --format=%h", {
      encoding: "utf8",
    }).trim();
    const commitDateRaw = execSync("git log -1 --format=%cd --date=format:%Y%m%d%H%M%S", {
      encoding: "utf8",
    }).trim();
    // Format as YYYY-MM-DD HH:MM:SS from the raw YYYYMMDDHHmmss.
    const commitDate = commitDateRaw.replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
      "$1-$2-$3 $4:$5:$6",
    );
    const commitMessage = execSync("git log -1 --format=%s", {
      encoding: "utf8",
    }).trim();
    const version = calendarVersion(timestamp);
    return JSON.stringify({ timestamp, commitHash, commitDate, commitMessage, version });
  } catch {
    const ts = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    return JSON.stringify({
      timestamp: ts,
      commitHash: "unknown",
      commitDate: "unknown",
      commitMessage: "unknown",
      version: calendarVersion(ts),
    });
  }
}

// Tauri-friendly Vite config.
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __BUILD_INFO__: getGitInfo(),
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
