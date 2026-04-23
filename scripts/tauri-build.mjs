// Orchestrator for production tauri builds: stamp the calendar version,
// run `tauri build`, and ALWAYS restore the base version afterwards
// (even if the build fails). Keeps the git tree clean.
//
// #120 — invoked via `npm run tauri:build`.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true, ...opts });
  return r.status ?? 1;
}

function stamp() {
  return run("node", ["scripts/stamp-version.mjs"]);
}

function reset() {
  return run("node", ["scripts/reset-version.mjs"]);
}

function main() {
  const stampStatus = stamp();
  if (stampStatus !== 0) {
    process.exit(stampStatus);
  }
  // Forward any extra CLI args to `tauri build`.
  const extra = process.argv.slice(2);
  const buildStatus = run("npx", ["tauri", "build", ...extra]);
  const resetStatus = reset();
  process.exit(buildStatus !== 0 ? buildStatus : resetStatus);
}

main();
