// ------------------------------------------------------------------
// Component: Observability log buffer (#129)
// Responsibility: In-process ring buffer that records the last N
//                 stream-lifecycle transitions (open / first-byte /
//                 usage / complete / error / retry / cancel / timeout)
//                 so intermittent provider bugs can be diagnosed
//                 without re-running with the file-backed trace.
// Collaborators: orchestration/streamRunner.ts (emits events),
//                lib/commands/handlers/info.ts (//log command dumps).
// ------------------------------------------------------------------

import type { ProviderId } from "../types";

export type LogEventType =
  | "open"
  | "first-byte"
  | "usage"
  | "complete"
  | "error"
  | "retrying"
  | "cancelled"
  | "timeout";

export interface LogEvent {
  /** ms since epoch. */
  ts: number;
  personaId: string | null;
  provider: ProviderId | null;
  model: string | null;
  event: LogEventType;
  /** HTTP status, error message, or retry reason. Null when N/A. */
  statusOrReason: string | null;
  /** ms since the stream opened. Null for the open event itself. */
  elapsedMs: number | null;
  /** bytes received so far. Null when not tracked. */
  bytes: number | null;
}

export interface LogBuffer {
  push(event: LogEvent): void;
  snapshot(opts?: { personaId?: string; limit?: number }): LogEvent[];
  clear(): void;
}

/**
 * Create a FIFO ring buffer capped at `capacity` events. Zero
 * capacity disables recording entirely (push is a no-op).
 */
export function createLogBuffer(capacity: number): LogBuffer {
  const events: LogEvent[] = [];
  return {
    push(event) {
      if (capacity <= 0) return;
      events.push(event);
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    snapshot(opts = {}) {
      let out = opts.personaId
        ? events.filter((e) => e.personaId === opts.personaId)
        : events.slice();
      if (opts.limit !== undefined && opts.limit < out.length) {
        out = out.slice(out.length - opts.limit);
      }
      return out;
    },
    clear() {
      events.length = 0;
    },
  };
}

// App-wide singleton. Capped at 500 — covers roughly the last several
// minutes of activity under normal load. Emit callers are in-process
// only; no telemetry leaves the device.
export const logBuffer = createLogBuffer(500);
