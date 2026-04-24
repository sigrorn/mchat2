// ------------------------------------------------------------------
// Component: Log snapshot formatter (#129)
// Responsibility: Render an array of LogEvent as a markdown table
//                 suitable for appending as a notice.
// Collaborators: lib/commands/handlers/info.ts (//log).
// ------------------------------------------------------------------

import type { LogEvent } from "./logBuffer";

function fmtTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function formatLogSnapshot(events: readonly LogEvent[], requested: number): string {
  if (events.length === 0) return "log: buffer is empty.";
  const lines: string[] = [];
  lines.push(`## Event log (last ${events.length}${events.length < requested ? "" : `, requested ${requested}`})`);
  lines.push("");
  lines.push("| time | persona | provider/model | event | detail | elapsed | bytes |");
  lines.push("|---|---|---|---|---|---:|---:|");
  for (const e of events) {
    const persona = e.personaId ?? "—";
    const provModel = [e.provider, e.model].filter(Boolean).join("/") || "—";
    const detail = e.statusOrReason ?? "";
    const elapsed = e.elapsedMs !== null ? `${e.elapsedMs}ms` : "";
    const bytes = e.bytes !== null ? String(e.bytes) : "";
    lines.push(
      `| ${fmtTs(e.ts)} | ${persona} | ${provModel} | ${e.event} | ${detail} | ${elapsed} | ${bytes} |`,
    );
  }
  return lines.join("\n");
}
