import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// #121 — the version lives in package.json (and src-tauri/Cargo.toml +
// tauri.conf.json), bumped per commit by scripts/bump-version.mjs.
// This function reads it and adds git metadata for the in-app display.
function getBuildInfo(): string {
  let version = "unknown";
  try {
    const pkgPath = path.resolve(__dirname, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    version = pkg.version ?? "unknown";
  } catch {
    // keep default "unknown"
  }
  try {
    const commitHash = execSync("git log -1 --format=%h", { encoding: "utf8" }).trim();
    const commitDateRaw = execSync(
      "git log -1 --format=%cd --date=format:%Y%m%d%H%M%S",
      { encoding: "utf8" },
    ).trim();
    const commitDate = commitDateRaw.replace(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
      "$1-$2-$3 $4:$5:$6",
    );
    const commitMessage = execSync("git log -1 --format=%s", { encoding: "utf8" }).trim();
    return JSON.stringify({ version, commitHash, commitDate, commitMessage });
  } catch {
    return JSON.stringify({
      version,
      commitHash: "unknown",
      commitDate: "unknown",
      commitMessage: "unknown",
    });
  }
}

// Tauri-friendly Vite config.
export default defineConfig(async ({ command }) => ({
  plugins: [react()],
  define: {
    __BUILD_INFO__: getBuildInfo(),
    // #166: dead-code-eliminate the browser-mock installer in prod
    // builds. `vite dev` (Tauri or browser) and `vite preview`
    // both run with command !== "build", so mocks load there as
    // before; `npm run build` ships without the chunk.
    __IS_DEV__: command !== "build",
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
    // #143: split the heavy diagram libs out of the main bundle into
    // named chunks. They're already lazy-imported (only loaded on the
    // first diagram block), but giving them stable names keeps the
    // initial bundle small and makes chunk-size warnings
    // self-explanatory.
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes("node_modules/mermaid")) return "diagrams-mermaid";
          if (id.includes("node_modules/@viz-js")) return "diagrams-viz";
          if (
            id.includes("node_modules/dompurify") ||
            id.includes("node_modules/isomorphic-dompurify")
          ) {
            return "sanitize";
          }
          return undefined;
        },
      },
    },
  },
}));
