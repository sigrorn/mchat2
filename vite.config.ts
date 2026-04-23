import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

// #120 — calendar-semver derived from the same git timestamp.
function calendarVersion(ts: string): string {
  // ts = YYYYMMDDHHMMSS. Build 0.YYYYMMDD.HHMM (leading-zero-stripped).
  const minor = ts.slice(0, 8);
  const patch = String(Number(ts.slice(8, 12)));
  return `0.${minor}.${patch}`;
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
