// ------------------------------------------------------------------
// Component: //pop mutation planner
// Responsibility: Given the current history, decide which ids to
//                 delete (the last user message + every following row)
//                 and what text to restore into the Composer so the
//                 user can edit and re-submit. Pure.
// Collaborators: components/Composer (runCommand pop branch),
//                persistence/messages.deleteMessagesAfter / deleteMessage.
// ------------------------------------------------------------------

import type { Message } from "../types";

export type PopPlan =
  | { ok: true; deleteIds: string[]; restoredText: string; lastUserIndex: number }
  | { ok: false; reason: "no_user_messages" };

export function planPop(messages: readonly Message[]): PopPlan {
  let lastUser: Message | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") {
      lastUser = m;
      break;
    }
  }
  if (!lastUser) return { ok: false, reason: "no_user_messages" };
  const deleteIds = messages.filter((m) => m.index >= lastUser!.index).map((m) => m.id);
  return {
    ok: true,
    deleteIds,
    restoredText: lastUser.content,
    lastUserIndex: lastUser.index,
  };
}
