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
  const allChars = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .reduce((s, m) => s + m.content.length, 0);
  const allTokens = estimateTokens(messages.map((m) => m.content).join(""));

  lines.push(`Chat stats — ${conversation.title}`);
  lines.push(`  all messages      ${allTokens.toLocaleString()} tokens (~${allChars.toLocaleString()} chars)`);

  for (const p of personas) {
    const target = { provider: p.provider, personaId: p.id, key: p.id, displayName: p.name };
    const ctx = buildContext({
      conversation,
      target,
      messages: [...messages],
      personas: [...personas],
      maxContextTokens: PROVIDER_REGISTRY[p.provider].maxContextTokens,
    });
    const chars = ctx.messages.reduce((s, m) => s + m.content.length, 0);
    const tokens = estimateTokens(ctx.messages.map((m) => m.content).join(""));
    lines.push(`  ${p.name.padEnd(16)} ${tokens.toLocaleString()} tokens (~${chars.toLocaleString()} chars)`);
  }

  return lines.join("\n");
}
