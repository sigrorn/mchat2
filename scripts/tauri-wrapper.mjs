// Wrapper for `tauri` CLI that stamps the calendar version when (and
// only when) the subcommand is `build`. Other subcommands (`dev`,
// `icon`, `info`, ...) pass through unchanged.
//
// Entry point for `npm run tauri <subcommand>`. Lets the user keep the
// familiar `npm run tauri build` habit without forgetting to stamp.
//
// #120 — paired with scripts/stamp-version.mjs and reset-version.mjs.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: true });
  return r.status ?? 1;
}

function stamp() {
  return run("node", ["scripts/stamp-version.mjs"]);
}

function reset() {
  return run("node", ["scripts/reset-version.mjs"]);
}

function main() {
  const args = process.argv.slice(2);
  const isBuild = args[0] === "build";
  if (!isBuild) {
    process.exit(run("npx", ["tauri", ...args]));
  }
  const stampStatus = stamp();
  if (stampStatus !== 0) {
    process.exit(stampStatus);
  }
  const buildStatus = run("npx", ["tauri", ...args]);
  const resetStatus = reset();
  process.exit(buildStatus !== 0 ? buildStatus : resetStatus);
}

main();
