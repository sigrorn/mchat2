// ------------------------------------------------------------------
// Component: backgroundTask helper
// Responsibility: Replace fire-and-forget `void someAsyncWrite(...)`
//                 patterns with an explicit "best-effort" call site
//                 that catches and logs failures. After ADR 011 closed
//                 the queue-bypass race, the remaining hazard with
//                 fire-and-forget DB writes is silent failure: the
//                 user sees stale UI without any signal that a write
//                 didn't land. backgroundTask makes failures visible
//                 in crashLog without forcing the caller to await.
// Collaborators: lib/observability/crashLog (structured log target).
// ------------------------------------------------------------------
//
// Convention:
//   - backgroundTask(label, fn) — best-effort, failures must be
//     observable. The default. Replaces `void asyncFn()`.
//   - await fn() — write must complete before the next user action
//     proceeds. Use when ordering matters.
//   - raw `void fn()` — genuinely fire-and-forget with no
//     observability needed (telemetry pings, etc.). Rare.

import { appendStructured } from "./crashLog";

export function backgroundTask<T>(
  label: string,
  fn: () => Promise<T>,
): void {
  fn().catch((err: unknown) => {
    const isError = err instanceof Error;
    const entry: import("./crashLog").StructuredLogEntry = {
      kind: "background-task-failed",
      label,
      error: isError ? err.message : String(err),
      ts: Date.now(),
    };
    if (isError && err.stack) entry.stack = err.stack;
    void appendStructured(entry);
  });
}
