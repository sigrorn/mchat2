// ------------------------------------------------------------------
// Component: triggerHelp (#237)
// Responsibility: Emit the //help notice unless the conversation's
//                 last visible row is already an identical help
//                 notice. Shared between the //help dispatcher
//                 branch and the //<TAB> shortcut from #238 so the
//                 dedup lives in one place.
// Collaborators: lib/commands/handlers/info (handleHelp wrapper),
//                future components/Composer Tab handler (#238).
// Pure(ish) — no DB; reads via deps, writes via deps.appendNotice.
// ------------------------------------------------------------------

import type { Message } from "@/lib/types";
import { formatHelp } from "./help";

export interface TriggerHelpDeps {
  getMessages: (conversationId: string) => readonly Message[];
  appendNotice: (conversationId: string, content: string) => Promise<unknown>;
}

export async function triggerHelp(
  deps: TriggerHelpDeps,
  conversationId: string,
): Promise<void> {
  const help = formatHelp();
  const last = lastVisibleNotice(deps.getMessages(conversationId));
  if (last && last.content === help) return;
  await deps.appendNotice(conversationId, help);
}

// Walk from the end of the message list and return the most recent
// row the user is currently looking at. Skip rows that are not
// visible in the chat: superseded (replaced by a replay/retry) and
// confirm-hidden (#229). Assistant turns and unrelated notices stop
// the walk — they don't reset the dedup state, they ARE the dedup
// state, so a non-help-notice "last visible" returns and the caller
// re-emits.
function lastVisibleNotice(messages: readonly Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    // #180 / #206: superseded rows are hidden by the renderer and the
    // context builder. They must not gate the dedup either.
    if ((m as { supersededAt?: number | null }).supersededAt != null) continue;
    // #229: confirm-hidden notices are removed from the visible chat.
    if (m.role === "notice" && m.confirmedAt != null) continue;
    return m;
  }
  return null;
}
