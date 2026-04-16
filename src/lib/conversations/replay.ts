// ------------------------------------------------------------------
// Component: Replay plan helper
// Responsibility: Given a user-row edit, produce the mutation plan:
//                 which message row to update (content + addressedTo),
//                 and which message ids to delete (everything at a
//                 later index). Pure so tests don't stub the repo.
// Collaborators: hooks/useSend.replay, persistence/messages.
// ------------------------------------------------------------------

import type { Message } from "../types";

export type ReplayPlan =
  | {
      ok: true;
      update: { id: string; content: string; addressedTo: string[] };
      deleteIds: string[];
    }
  | { ok: false; reason: "not_found" | "not_user_message" };

export function planReplay(
  messages: readonly Message[],
  messageId: string,
  newContent: string,
  newAddressedTo: readonly string[],
): ReplayPlan {
  const edited = messages.find((m) => m.id === messageId);
  if (!edited) return { ok: false, reason: "not_found" };
  if (edited.role !== "user") return { ok: false, reason: "not_user_message" };
  const deleteIds = messages.filter((m) => m.index > edited.index).map((m) => m.id);
  return {
    ok: true,
    update: {
      id: edited.id,
      content: newContent,
      addressedTo: [...newAddressedTo],
    },
    deleteIds,
  };
}
