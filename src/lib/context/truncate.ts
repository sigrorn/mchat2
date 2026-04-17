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
  // The user-message number of the first surviving non-pinned message,
  // so the notice can say "dropped messages before #N".
  firstSurvivingUserNumber: number | null;
}

// Each entry in sourceInfo corresponds 1:1 to the messages array and
// carries metadata the truncator needs from the original Message rows.
export interface SourceInfo {
  pinned: boolean;
  // 1-indexed user-message number (only set for role=user; null for
  // assistant / other rows). Used for the notice text.
  userNumber: number | null;
}

interface Turn {
  indices: number[];
  cost: number;
  pinned: boolean; // true if ANY member is pinned
  userNumber: number | null; // from the turn's user-role message
}

export function truncateToFit(
  systemPrompt: string | null,
  messages: readonly ChatMessage[],
  maxTokens: number,
  sourceInfo?: readonly SourceInfo[],
): TruncateResult {
  const budget = Math.floor(maxTokens * BUFFER_FACTOR);
  const systemCost = systemPrompt ? estimateTokens(systemPrompt) : 0;

  const costs = messages.map((m) => estimateTokens(m.content));
  let total = systemCost + costs.reduce((a, b) => a + b, 0);

  if (total <= budget) {
    return { messages: [...messages], dropped: 0, firstSurvivingUserNumber: null };
  }

  // Group into turns: each user message starts a new turn; following
  // assistant messages belong to the same turn. Messages before the
  // first user message (e.g. pinned identity rows) form turn 0.
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const info = sourceInfo?.[i];
    if (m.role === "user") {
      if (current) turns.push(current);
      current = {
        indices: [i],
        cost: costs[i]!,
        pinned: !!info?.pinned,
        userNumber: info?.userNumber ?? null,
      };
    } else {
      if (!current) {
        current = { indices: [], cost: 0, pinned: false, userNumber: null };
      }
      current.indices.push(i);
      current.cost += costs[i]!;
      if (info?.pinned) current.pinned = true;
    }
  }
  if (current) turns.push(current);

  // Never drop the last turn (it contains the user's most recent prompt).
  const keepTurn = new Array<boolean>(turns.length).fill(true);
  let dropped = 0;

  for (let t = 0; t < turns.length - 1 && total > budget; t++) {
    const turn = turns[t]!;
    if (turn.pinned) continue;
    keepTurn[t] = false;
    total -= turn.cost;
    dropped += turn.indices.length;
  }

  const kept = new Set<number>();
  for (let t = 0; t < turns.length; t++) {
    if (!keepTurn[t]) continue;
    for (const idx of turns[t]!.indices) kept.add(idx);
  }

  // Find the first surviving user-message number for the notice.
  let firstSurvivingUserNumber: number | null = null;
  for (let t = 0; t < turns.length; t++) {
    if (!keepTurn[t]) continue;
    const turn = turns[t]!;
    if (turn.userNumber !== null && !turn.pinned) {
      firstSurvivingUserNumber = turn.userNumber;
      break;
    }
  }

  return {
    messages: messages.filter((_, i) => kept.has(i)),
    dropped,
    firstSurvivingUserNumber,
  };
}
