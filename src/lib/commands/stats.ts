// ------------------------------------------------------------------
// Component: Stats formatter
// Responsibility: Compute and format per-persona context size stats
//                 for the //stats command.
// Collaborators: components/Composer.tsx, context/builder.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { buildContext } from "../context/builder";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { estimateTokens } from "../context/truncate";

export function formatStats(
  conversation: Conversation,
  messages: readonly Message[],
  personas: readonly Persona[],
): string {
  if (personas.length === 0) return "stats: no personas.";

  const lines: string[] = [];
  const allTokens = estimateTokens(messages.map((m) => m.content).join(""));

  lines.push(`Chat stats — ${conversation.title}`);
  lines.push(`  all messages      ${allTokens.toLocaleString()} tokens`);

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
    const pctLabel = Number.isFinite(maxContext) && maxContext > 0
      ? `${((tokens / maxContext) * 100).toFixed(2)}% of max context`
      : "unlimited context";
    lines.push(
      `  ${p.name.padEnd(16)} ${tokens.toLocaleString()} tokens (${pctLabel})`,
    );
  }

  return lines.join("\n");
}
