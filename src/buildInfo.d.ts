// Build-time constants injected by vite define in vite.config.ts.
// Version comes from package.json (bumped per commit by
// scripts/bump-version.mjs, see #121). Git metadata from the last
// commit at build time.
declare const __BUILD_INFO__: {
  // MAJOR.MINOR.BUILD — issue-based version, e.g. "1.21.1".
  version: string;
  commitHash: string;
  commitDate: string;
  commitMessage: string;
};
