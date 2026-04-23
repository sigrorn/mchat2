// Build-time constants injected by vite define in vite.config.ts.
// Values come from git at build time; see getGitInfo().
declare const __BUILD_INFO__: {
  // Raw YYYYMMDDHHMMSS timestamp of the last commit.
  timestamp: string;
  commitHash: string;
  commitDate: string;
  commitMessage: string;
  // #120 — calendar-semver: 0.YYYYMMDD.HHMM (leading-zero-stripped).
  version: string;
};
