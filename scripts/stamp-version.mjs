// Stamp the calendar-semver version (0.YYYYMMDD.HHMM from last git
// commit) into package.json and src-tauri/tauri.conf.json. Saves the
// original version strings to .version-backup.json so reset-version.mjs
// can restore them after the build.
//
// #120 — unifies the bundle/installer version with the in-app
// build timestamp.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calendarVersionFromGit } from "./versionFromGit.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = resolve(ROOT, "package.json");
const TAURI_CONF = resolve(ROOT, "src-tauri", "tauri.conf.json");
const BACKUP = resolve(ROOT, ".version-backup.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function setVersionField(path, newVersion) {
  const raw = readFileSync(path, "utf8");
  // Preserve original formatting: only replace the top-level "version"
  // string rather than reflowing the whole file through JSON.stringify.
  const updated = raw.replace(
    /^(\s*)"version"(\s*):(\s*)"[^"]*"/m,
    (_, a, b, c) => `${a}"version"${b}:${c}"${newVersion}"`,
  );
  writeFileSync(path, updated, "utf8");
}

function main() {
  const version = calendarVersionFromGit();
  const pkg = readJson(PKG);
  const tauri = readJson(TAURI_CONF);
  const backup = {
    "package.json": pkg.version,
    "src-tauri/tauri.conf.json": tauri.version,
    stamped: version,
    stampedAt: Date.now(),
  };
  writeJson(BACKUP, backup);

  setVersionField(PKG, version);
  setVersionField(TAURI_CONF, version);

  console.log(`stamped version ${version} into package.json and tauri.conf.json`);
  console.log(`backup written to ${BACKUP}`);
}

main();
