// Compute the calendar-semver version string (0.YYYYMMDD.HHMM) from
// the last git commit timestamp. Shared by stamp-version.mjs and
// tauri-build.mjs; also kept in sync with vite.config.ts's in-app
// version display.
//
// Semver forbids leading zeros in numeric identifiers, so HHMM is
// coerced via Number() (e.g. "0523" → 523). A build at 00:00 produces
// patch "0".

import { execSync } from "node:child_process";

export function calendarVersionFromGit() {
  const ts = execSync("git log -1 --format=%cd --date=format:%Y%m%d%H%M%S", {
    encoding: "utf8",
  }).trim();
  // ts = "YYYYMMDDHHMMSS"
  const minor = ts.slice(0, 8); // YYYYMMDD
  const patch = String(Number(ts.slice(8, 12))); // HHMM, leading zeros stripped
  return `0.${minor}.${patch}`;
}
