// ------------------------------------------------------------------
// Component: Context truncation
// Responsibility: Drop the oldest non-pinned messages from a built
//                 ChatMessage[] until the estimated token count fits
//                 the provider's maximum (#55). Pure — buildContext
//                 calls this after the 8 visibility rules produce
//                 the final message list.
// Collaborators: context/builder.ts, providers/registry.ts.
// ------------------------------------------------------------------

import type { ChatMessage } from "../providers/adapter";

const CHARS_PER_TOKEN = 4;
const BUFFER_FACTOR = 0.9;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface TruncateResult {
  messages: ChatMessage[];
  dropped: number;
}

export function truncateToFit(
  systemPrompt: string | null,
  messages: readonly ChatMessage[],
  maxTokens: number,
  pinnedIndices?: ReadonlySet<number>,
): TruncateResult {
  const budget = Math.floor(maxTokens * BUFFER_FACTOR);
  const systemCost = systemPrompt ? estimateTokens(systemPrompt) : 0;

  const costs = messages.map((m) => estimateTokens(m.content));
  let total = systemCost + costs.reduce((a, b) => a + b, 0);

  if (total <= budget) {
    return { messages: [...messages], dropped: 0 };
  }

  const keep = new Array<boolean>(messages.length).fill(true);
  const pinned = pinnedIndices ?? new Set<number>();
  let dropped = 0;

  // Walk oldest-first, skip pinned and the very last message.
  for (let i = 0; i < messages.length - 1 && total > budget; i++) {
    if (pinned.has(i)) continue;
    keep[i] = false;
    total -= costs[i]!;
    dropped++;
  }

  return {
    messages: messages.filter((_, i) => keep[i]),
    dropped,
  };
}
