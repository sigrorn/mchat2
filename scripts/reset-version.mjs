// Restore package.json and src-tauri/tauri.conf.json to the versions
// recorded in .version-backup.json (by stamp-version.mjs). Removes the
// backup file on success.
//
// #120 — paired with stamp-version.mjs so git stays clean after a
// production tauri build.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PKG = resolve(ROOT, "package.json");
const TAURI_CONF = resolve(ROOT, "src-tauri", "tauri.conf.json");
const BACKUP = resolve(ROOT, ".version-backup.json");

function setVersionField(path, newVersion) {
  const raw = readFileSync(path, "utf8");
  const updated = raw.replace(
    /^(\s*)"version"(\s*):(\s*)"[^"]*"/m,
    (_, a, b, c) => `${a}"version"${b}:${c}"${newVersion}"`,
  );
  writeFileSync(path, updated, "utf8");
}

function main() {
  if (!existsSync(BACKUP)) {
    console.log("reset-version: no backup found — nothing to restore.");
    return;
  }
  const backup = JSON.parse(readFileSync(BACKUP, "utf8"));
  setVersionField(PKG, backup["package.json"]);
  setVersionField(TAURI_CONF, backup["src-tauri/tauri.conf.json"]);
  unlinkSync(BACKUP);
  console.log(
    `restored package.json=${backup["package.json"]}, tauri.conf.json=${backup["src-tauri/tauri.conf.json"]}`,
  );
}

main();
