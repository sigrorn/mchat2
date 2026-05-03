// ------------------------------------------------------------------
// Component: Unread indicator predicate (#250)
// Responsibility: Decide whether the sidebar row for a conversation
//                 shows the "new content since you last looked" dot.
//                 Pure — Sidebar.tsx feeds the persisted last_message_at
//                 + last_seen_at columns plus the active-conversation
//                 flag; the dot renders iff this returns true.
// Collaborators: components/Sidebar.tsx (read site),
//                stores/conversationsStore.ts (writes lastSeenAt on
//                activate), lib/persistence/messages.ts (bumps
//                lastMessageAt on append).
// ------------------------------------------------------------------

export interface HasUnreadInputs {
  /** Persisted Date.now() of the most recent message append in the
   *  conversation. 0 for conversations that have never had a message. */
  lastMessageAt: number;
  /** Persisted Date.now() stamped each time the conversation became
   *  the active one. 0 until the user has visited the conversation. */
  lastSeenAt: number;
  /** True when this conversation is currently the active one in the UI.
   *  The active conversation never shows the dot — the user is by
   *  definition looking at it, even if a placeholder just landed. */
  isActive: boolean;
}

export function hasUnread(inputs: HasUnreadInputs): boolean {
  if (inputs.isActive) return false;
  return inputs.lastMessageAt > inputs.lastSeenAt;
}
