// ------------------------------------------------------------------
// Component: Limit-exclusion check (UI)
// Responsibility: Mirror the context-builder's limit-mark filter so
//                 the UI can shade rows that the LLM won't see. The
//                 builder rule is the source of truth; this helper
//                 just exposes the same predicate at render time.
// Collaborators: components/MessageList.tsx.
// ------------------------------------------------------------------

import type { Conversation, Message } from "../types";

export function isExcludedByLimit(message: Message, conversation: Conversation): boolean {
  if (conversation.limitMarkIndex === null) return false;
  if (message.role === "notice") return false;
  if (message.pinned) return false;
  return message.index < conversation.limitMarkIndex;
}
