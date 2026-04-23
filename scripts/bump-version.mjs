// CLI that bumps the issue-based version before a commit (#121).
//
// Usage:
//   node scripts/bump-version.mjs -m "<commit message>"
//   npm run bump -- -m "<commit message>"
//
// Behavior:
//   - If the message is a test commit ("tests:" prefix): no-op.
//   - Else parses the first #NNN from the message; aborts if missing.
//   - Loads .build-counter.json (initialises to 0.0.0 if missing).
//   - Computes the next version per the never-go-backwards rule.
//   - Writes the new version into package.json, tauri.conf.json,
//     and Cargo.toml, and updates .build-counter.json.
//   - Stages all four files with `git add`.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import {
  isTestCommit,
  parseIssueNumber,
  computeNextVersion,
  formatVersion,
} from "./bumpLogic.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const COUNTER = resolve(ROOT, ".build-counter.json");
const PKG = resolve(ROOT, "package.json");
const TAURI_CONF = resolve(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML = resolve(ROOT, "src-tauri", "Cargo.toml");

function readCounter() {
  if (!existsSync(COUNTER)) return { major: 0, minor: 0, build: 0 };
  return JSON.parse(readFileSync(COUNTER, "utf8"));
}

function writeCounter(v) {
  writeFileSync(COUNTER, JSON.stringify(v, null, 2) + "\n", "utf8");
}

function setJsonVersion(path, newVersion) {
  const raw = readFileSync(path, "utf8");
  const updated = raw.replace(
    /^(\s*)"version"(\s*):(\s*)"[^"]*"/m,
    (_, a, b, c) => `${a}"version"${b}:${c}"${newVersion}"`,
  );
  writeFileSync(path, updated, "utf8");
}

function setTomlVersion(path, newVersion) {
  const raw = readFileSync(path, "utf8");
  const updated = raw.replace(
    /^(\s*)version(\s*)=(\s*)"[^"]*"/m,
    (_, a, b, c) => `${a}version${b}=${c}"${newVersion}"`,
  );
  writeFileSync(path, updated, "utf8");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let message = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-m" || a === "--message") {
      message = args[i + 1];
      i++;
    } else if (a.startsWith("--message=")) {
      message = a.slice("--message=".length);
    } else if (!message && !a.startsWith("-")) {
      message = a;
    }
  }
  return message;
}

function main() {
  const message = parseArgs(process.argv);
  if (!message) {
    console.error('bump-version: no commit message provided. Use -m "<message>".');
    process.exit(1);
  }
  if (isTestCommit(message)) {
    console.log("bump-version: test commit — no version bump.");
    return;
  }
  const issue = parseIssueNumber(message);
  if (issue === null) {
    console.error(
      "bump-version: no issue reference (#NNN) found in the commit message. Aborting.",
    );
    console.error(`  message: ${message}`);
    process.exit(1);
  }
  const current = readCounter();
  const next = computeNextVersion(current, issue);
  const versionStr = formatVersion(next);
  writeCounter(next);
  setJsonVersion(PKG, versionStr);
  setJsonVersion(TAURI_CONF, versionStr);
  setTomlVersion(CARGO_TOML, versionStr);
  try {
    execSync(`git add "${COUNTER}" "${PKG}" "${TAURI_CONF}" "${CARGO_TOML}"`, {
      stdio: "inherit",
    });
  } catch {
    console.warn("bump-version: git add failed (not fatal). Stage the files manually.");
  }
  console.log(`bump-version: ${formatVersion(current)} → ${versionStr}`);
}

main();
