// ------------------------------------------------------------------
// Component: Trace formatter
// Responsibility: Pure formatting helpers for the per-persona '.txt'
//                 trace files (#40). I/O lives in the orchestrator
//                 that consumes these rows and appends them to disk.
// Collaborators: src/lib/orchestration/streamRunner.ts (caller),
//                src/lib/tauri/filesystem.ts (the actual writer).
// ------------------------------------------------------------------

import type { ChatMessage } from "../providers/adapter";

export type TraceDirection = "O" | "I";

// HHMMSS.mmm — local time, three-digit milliseconds. Matches old mchat's
// strftime('%H%M%S.') + microsecond//1000 output exactly.
export function formatTimestamp(d: Date): string {
  const pad = (n: number, w = 2): string => n.toString().padStart(w, "0");
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// Format a list of payload entries (each potentially multi-line) into
// trace rows sharing a single timestamp + direction prefix.
export function formatTraceLines(
  ts: Date,
  direction: TraceDirection,
  payloads: readonly string[],
): string[] {
  const prefix = `${formatTimestamp(ts)} ${direction} `;
  const out: string[] = [];
  for (const payload of payloads) {
    const lines = payload.split("\n");
    for (const line of lines) {
      out.push(`${prefix}${line}`);
    }
  }
  return out;
}

// Build the rows for one outbound request. Mirrors the old mchat loop
// over the messages array, with the system prompt prepended as a
// '[system] …' entry when present.
export function buildOutboundRows(
  ts: Date,
  systemPrompt: string | null,
  messages: readonly ChatMessage[],
): string[] {
  const payloads: string[] = [];
  if (systemPrompt !== null) payloads.push(`[system] ${systemPrompt}`);
  for (const m of messages) {
    payloads.push(`[${m.role}] ${m.content}`);
  }
  return formatTraceLines(ts, "O", payloads);
}

// Inbound row(s) for the accumulated reply. Empty content yields no
// rows so silent-failed runs don't leave a stray timestamp in the file.
export function buildInboundRows(ts: Date, content: string): string[] {
  if (!content) return [];
  return formatTraceLines(ts, "I", [content]);
}
