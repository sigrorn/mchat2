// ------------------------------------------------------------------
// Component: Stats formatter
// Responsibility: Compute and format per-persona stats as a markdown
//                 table. Columns (#122, #132):
//                   persona | user messages | in tokens | out tokens |
//                   context tokens | % of max | avg TTFT | avg tok/s
//                 All persona-scoped counters reset at the compaction
//                 floor (rows with index < compactionFloorIndex are
//                 excluded from the sums).
// Collaborators: components/Composer.tsx via lib/commands/dispatch.ts,
//                context/builder.ts, personaTimings.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { buildContext } from "../context/builder";
import { maxContextTokensForPersona } from "../providers/contextWindows";
import { estimateTokens } from "../context/truncate";
import { isCountableUserMessage } from "../conversations/compactionCutoff";
import { aggregatePersonaTimings } from "./personaTimings";

/**
 * Count the user messages visible to `persona` that sit at or above
 * the current compactionFloor (or 0 if none). Excludes pinned user
 * messages. This matches what //compact -N preserves.
 */
function countUserMessagesSinceCompaction(
  messages: readonly Message[],
  conversation: Conversation,
  persona: Persona,
): number {
  const floor = conversation.compactionFloorIndex ?? 0;
  let count = 0;
  for (const m of messages) {
    if (m.index < floor) continue;
    if (!isCountableUserMessage(m, persona.id)) continue;
    count++;
  }
  return count;
}

/**
 * Sum inputTokens and outputTokens on `persona`'s assistant rows at
 * or above the compaction floor. User rows and other personas'
 * assistant rows are excluded. Rows with no usage recorded
 * contribute zero (#132).
 */
function sumPersonaTokensSinceCompaction(
  messages: readonly Message[],
  conversation: Conversation,
  persona: Persona,
): { inTokens: number; outTokens: number } {
  const floor = conversation.compactionFloorIndex ?? 0;
  let inTokens = 0;
  let outTokens = 0;
  for (const m of messages) {
    if (m.index < floor) continue;
    if (m.role !== "assistant") continue;
    if (m.personaId !== persona.id) continue;
    inTokens += m.inputTokens;
    outTokens += m.outputTokens;
  }
  return { inTokens, outTokens };
}

/**
 * Format TTFT as milliseconds with a thousands separator (#136).
 * Mixed ms/s units broke visual comparability — "432ms" read as
 * larger than "1.4s" at a glance.
 */
function formatTtft(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

/** Format throughput as an integer "45 tok/s". */
function formatTokensPerSec(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value)} tok/s`;
}

export function formatStats(
  conversation: Conversation,
  messages: readonly Message[],
  personas: readonly Persona[],
): string {
  if (personas.length === 0) return "stats: no personas.";

  const allTokens = estimateTokens(messages.map((m) => m.content).join(""));
  const floor = conversation.compactionFloorIndex ?? 0;

  const lines: string[] = [];
  lines.push("## Chat stats");
  lines.push("");
  lines.push(
    "| persona | user messages | in tokens | out tokens | context tokens | % of max context | avg TTFT | avg tok/s |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  lines.push(`| all messages |  |  |  | ${allTokens.toLocaleString()} |  |  |  |`);

  for (const p of personas) {
    const target = { provider: p.provider, personaId: p.id, key: p.id, displayName: p.name };
    const maxContext = maxContextTokensForPersona(p);
    const ctx = buildContext({
      conversation,
      target,
      messages: [...messages],
      personas: [...personas],
      maxContextTokens: maxContext,
    });
    const tokens = estimateTokens(ctx.messages.map((m) => m.content).join(""));
    const pctLabel =
      Number.isFinite(maxContext) && maxContext > 0
        ? `${((tokens / maxContext) * 100).toFixed(2)}%`
        : "unlimited";
    const userCount = countUserMessagesSinceCompaction(messages, conversation, p);
    const usage = sumPersonaTokensSinceCompaction(messages, conversation, p);
    const timings = aggregatePersonaTimings(p, messages, floor);
    lines.push(
      `| ${p.name} | ${userCount} | ${usage.inTokens.toLocaleString()} | ${usage.outTokens.toLocaleString()} | ${tokens.toLocaleString()} | ${pctLabel} | ${formatTtft(timings.avgTtftMs)} | ${formatTokensPerSec(timings.avgTokensPerSec)} |`,
    );
  }

  return lines.join("\n");
}
