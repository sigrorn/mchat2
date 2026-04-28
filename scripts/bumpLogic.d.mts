// Type declarations for scripts/bumpLogic.mjs — consumed by tests
// under tests/unit/scripts/. Keeps TypeScript strict while the script
// itself stays plain ESM for direct node execution.

export interface Version {
  major: number;
  minor: number;
  build: number;
}

export function isTestCommit(message: string): boolean;
export function parseIssueNumber(message: string): number | null;
export function computeNextVersion(
  current: Partial<Version>,
  issueNumber: number,
): Version;
export function formatVersion(v: Version): string;
export function updateCargoLockMchat2Version(raw: string, newVersion: string): string;
