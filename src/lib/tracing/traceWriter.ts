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

// #205: an adapter-reported error tagged onto the inbound row so
// failed runs (HTTP 400, validation errors, etc.) actually show up
// in the trace file for diagnosis. Pre-#205 traces dropped these
// because content was empty and silent-failure suppression also
// suppressed the error.
export interface TraceInboundError {
  message: string;
  transient: boolean;
}

// Inbound row(s) for one stream's reply. Combines accumulated content
// (when the stream produced tokens) with any adapter-reported error
// under a single timestamp. Empty content + no error still yields no
// rows so genuinely silent failures don't pollute the trace.
export function buildInboundRows(
  ts: Date,
  content: string,
  error?: TraceInboundError | null,
): string[] {
  const payloads: string[] = [];
  if (content) payloads.push(content);
  if (error) {
    const tag = error.transient ? "transient" : "permanent";
    payloads.push(`[error/${tag}] ${error.message}`);
  }
  if (payloads.length === 0) return [];
  return formatTraceLines(ts, "I", payloads);
}
