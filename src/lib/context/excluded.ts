// ------------------------------------------------------------------
// Component: Limit-exclusion check (UI)
// Responsibility: Mirror the context-builder's limit-mark filter so
//                 the UI can shade rows that the LLM won't see. The
//                 builder rule is the source of truth; this helper
//                 just exposes the same predicate at render time.
// Collaborators: components/MessageList.tsx.
// ------------------------------------------------------------------

import type { Conversation, Message } from "../types";

// effectiveLimitIndex is optionally computed by the caller from the
// limitSizeTokens sliding window (#64). When provided, it takes the
// tighter of limitMarkIndex and the sliding-window cutoff.
export function isExcludedByLimit(
  message: Message,
  conversation: Conversation,
  effectiveLimitIndex?: number | null,
): boolean {
  const fixedMark = conversation.limitMarkIndex;
  const slidingMark = effectiveLimitIndex ?? null;
  const mark =
    fixedMark !== null && slidingMark !== null
      ? Math.max(fixedMark, slidingMark)
      : (fixedMark ?? slidingMark);
  if (mark === null) return false;
  if (message.role === "notice") return false;
  if (message.pinned) return false;
  return message.index < mark;
}
