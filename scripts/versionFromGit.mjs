// Compute the MSI-compatible version string from the last git commit
// timestamp. Shared by stamp-version.mjs / tauri-build.mjs / vite
// config.
//
// Format: YY.M.DAYMIN where
//   YY     = year - 2000 (fits Windows MSI limit of 0-255)
//   M      = month (1-12, fits 0-255)
//   DAYMIN = (day-1)*1440 + hour*60 + minute (fits 0-65535)
//
// Example: 2026-04-23 15:35 → "26.4.32615".
//
// Rationale: Windows MSI versions cap at 255.255.65535, so the more
// human-readable 0.YYYYMMDD.HHMM format (which has minor > 255) isn't
// buildable. Each build within a year is still unique to the minute.

import { execSync } from "node:child_process";

export function calendarVersionFromGit() {
  const ts = execSync("git log -1 --format=%cd --date=format:%Y%m%d%H%M%S", {
    encoding: "utf8",
  }).trim();
  return encodeCalendarVersion(ts);
}

export function encodeCalendarVersion(ts) {
  // ts = "YYYYMMDDHHMMSS"
  const year = Number(ts.slice(0, 4));
  const month = Number(ts.slice(4, 6));
  const day = Number(ts.slice(6, 8));
  const hour = Number(ts.slice(8, 10));
  const minute = Number(ts.slice(10, 12));
  const yy = year - 2000;
  const daymin = (day - 1) * 1440 + hour * 60 + minute;
  return `${yy}.${month}.${daymin}`;
}
