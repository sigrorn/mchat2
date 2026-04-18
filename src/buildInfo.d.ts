// Build-time constants injected by vite define in vite.config.ts.
// Values come from git at build time; see getGitInfo().
declare const __BUILD_INFO__: {
  timestamp: string;
  commitHash: string;
  commitDate: string;
  commitMessage: string;
};
