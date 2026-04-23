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
const CARGO_TOML = resolve(ROOT, "src-tauri", "Cargo.toml");
const BACKUP = resolve(ROOT, ".version-backup.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function setJsonVersionField(path, newVersion) {
  const raw = readFileSync(path, "utf8");
  // Preserve original formatting: only replace the top-level "version"
  // string rather than reflowing the whole file through JSON.stringify.
  const updated = raw.replace(
    /^(\s*)"version"(\s*):(\s*)"[^"]*"/m,
    (_, a, b, c) => `${a}"version"${b}:${c}"${newVersion}"`,
  );
  writeFileSync(path, updated, "utf8");
}

function setTomlVersionField(path, newVersion) {
  const raw = readFileSync(path, "utf8");
  // Match `version = "..."` only within the [package] section header
  // (or at file start before any other section). Simple pattern: the
  // first `version = "..."` line in the file.
  const updated = raw.replace(
    /^(\s*)version(\s*)=(\s*)"[^"]*"/m,
    (_, a, b, c) => `${a}version${b}=${c}"${newVersion}"`,
  );
  writeFileSync(path, updated, "utf8");
}

function readTomlVersion(path) {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^\s*version\s*=\s*"([^"]*)"/m);
  return match?.[1] ?? "unknown";
}

function main() {
  const version = calendarVersionFromGit();
  const pkg = readJson(PKG);
  const tauri = readJson(TAURI_CONF);
  const backup = {
    "package.json": pkg.version,
    "src-tauri/tauri.conf.json": tauri.version,
    "src-tauri/Cargo.toml": readTomlVersion(CARGO_TOML),
    stamped: version,
    stampedAt: Date.now(),
  };
  writeJson(BACKUP, backup);

  setJsonVersionField(PKG, version);
  setJsonVersionField(TAURI_CONF, version);
  setTomlVersionField(CARGO_TOML, version);

  console.log(
    `stamped version ${version} into package.json, tauri.conf.json, and Cargo.toml`,
  );
  console.log(`backup written to ${BACKUP}`);
}

main();
