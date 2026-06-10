// Pure logic for issue-based version bumping (#121). Separated from
// IO for testability: every function here is a deterministic mapping
// from inputs to outputs with no side effects.
//
// Encoding: MAJOR.MINOR.BUILD where MAJOR = floor(issue/100),
// MINOR = issue%100, BUILD = counter. Fits Windows MSI limits
// (255.255.65535) for issues up to 25599.

/** True if the commit subject starts with "tests:" (case-insensitive). */
export function isTestCommit(message) {
  return /^\s*tests?:/i.test(message);
}

/** Extract the first #NNN from the message. Returns null if none. */
export function parseIssueNumber(message) {
  const m = message.match(/#(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Compute the next version given the current state and a new issue.
 * Rule: never go backwards. If (newMajor, newMinor) > current, advance
 * to the new major.minor with build=1. Otherwise keep current and
 * increment build — which covers both "same issue, next attempt" and
 * "lower issue, treat as build increment".
 */
export function computeNextVersion(current, issueNumber) {
  const newMajor = Math.floor(issueNumber / 100);
  const newMinor = issueNumber % 100;
  const currMajor = current.major ?? 0;
  const currMinor = current.minor ?? 0;
  const currBuild = current.build ?? 0;
  const advances = newMajor > currMajor || (newMajor === currMajor && newMinor > currMinor);
  if (advances) {
    return { major: newMajor, minor: newMinor, build: 1 };
  }
  return { major: currMajor, minor: currMinor, build: currBuild + 1 };
}

/** Format a version record as a semver string. */
export function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.build}`;
}

// Parse a semver string (MAJOR.MINOR.BUILD) back into the counter
// record. #317: package.json's version is the single source of truth for
// the build counter -- it already encodes the identical triple -- so the
// bump script derives state from it instead of a separate, git-tracked
// .build-counter.json that guaranteed merge conflicts. Any pre-release
// suffix beyond the triple is ignored; a malformed string falls back to
// 0.0.0 (the bump then advances normally).
export function parseVersion(versionString) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(versionString).trim());
  if (!m) return { major: 0, minor: 0, build: 0 };
  return { major: Number(m[1]), minor: Number(m[2]), build: Number(m[3]) };
}

// Cargo rewrites the [[package]] name = "mchat2" / version = "..."
// pair on every build, so the bump script must pre-update it to keep
// the working tree clean (#207). This is a pure helper so the test
// suite can exercise it without filesystem IO.
export function updateCargoLockMchat2Version(raw, newVersion) {
  const pattern = /(name = "mchat2"(\r?\n)version = ")([^"]*)(")/;
  if (!pattern.test(raw)) {
    throw new Error('updateCargoLockMchat2Version: no [[package]] entry for "mchat2" found in Cargo.lock');
  }
  return raw.replace(pattern, (_, prefix, _eol, _old, suffix) => `${prefix}${newVersion}${suffix}`);
}
