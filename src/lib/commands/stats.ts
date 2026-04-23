// ------------------------------------------------------------------
// Component: Stats formatter
// Responsibility: Compute and format per-persona context size stats
//                 as a markdown table (#119). Columns: persona,
//                 user messages since last compaction, tokens,
//                 % of that persona's max context.
// Collaborators: components/Composer.tsx, context/builder.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { buildContext } from "../context/builder";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { estimateTokens } from "../context/truncate";
import { isCountableUserMessage } from "../conversations/compactionCutoff";

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

export function formatStats(
  conversation: Conversation,
  messages: readonly Message[],
  personas: readonly Persona[],
): string {
  if (personas.length === 0) return "stats: no personas.";

  const allTokens = estimateTokens(messages.map((m) => m.content).join(""));

  const lines: string[] = [];
  lines.push(`## Chat stats — ${conversation.title}`);
  lines.push("");
  lines.push("| persona | user messages | tokens | % of max context |");
  lines.push("|---|---:|---:|---:|");
  lines.push(`| all messages |  | ${allTokens.toLocaleString()} |  |`);

  for (const p of personas) {
    const target = { provider: p.provider, personaId: p.id, key: p.id, displayName: p.name };
    const maxContext = PROVIDER_REGISTRY[p.provider].maxContextTokens;
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
    lines.push(
      `| ${p.name} | ${userCount} | ${tokens.toLocaleString()} | ${pctLabel} |`,
    );
  }

  return lines.join("\n");
}
