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

// #166: build-time gate around dev-only imports (the browser-mocks
// installer). True in `vite dev` and Playwright; false in production
// Tauri builds. Folded into a static `if (__IS_DEV__) { ... }` so
// Rollup can dead-code-eliminate the entire branch and never emit the
// chunk into dist/.
declare const __IS_DEV__: boolean;
