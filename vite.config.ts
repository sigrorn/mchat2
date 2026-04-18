import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

function getGitInfo(): { timestamp: string; commitHash: string; commitDate: string } {
  try {
    const timestamp = execSync("git log -1 --format=%cd --date=format:%Y%m%d%H%M%S", {
      encoding: "utf8",
    }).trim();
    const commitHash = execSync("git log -1 --format=%h", {
      encoding: "utf8",
    }).trim();
    const commitDate = execSync("git log -1 --format=%cd --date=format:%Y-%m-%d %H:%M:%S", {
      encoding: "utf8",
    }).trim();
    return { timestamp, commitHash, commitDate };
  } catch {
    const ts = new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);
    return { timestamp: ts, commitHash: "unknown", commitDate: "unknown" };
  }
}

// Tauri-friendly Vite config.
export default defineConfig(async () => ({
  plugins: [react()],
  define: (() => {
    const git = getGitInfo();
    return {
      __BUILD_TIMESTAMP__: JSON.stringify(git.timestamp),
      __BUILD_COMMIT_HASH__: JSON.stringify(git.commitHash),
      __BUILD_COMMIT_DATE__: JSON.stringify(git.commitDate),
    };
  })(),
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
