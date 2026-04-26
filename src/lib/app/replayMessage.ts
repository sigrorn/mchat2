// ------------------------------------------------------------------
// Component: replayMessage (lib/app)
// Responsibility: Edit a previous user message and re-run downstream
//                 assistant replies. Restores the original
//                 addressedTo when the edited text doesn't include
//                 explicit @-targets (#92), truncates the conversation
//                 past the edited row, and runs the planned send.
//                 Originally part of useSend.replay; lifted here in
//                 #152.
// Collaborators: lib/personas/resolver, lib/conversations/replay,
//                lib/persistence/messages, lib/app/runPlannedSend,
//                lib/app/sendSelection, hooks/useSend (wires deps).
// ------------------------------------------------------------------

import type { Conversation } from "@/lib/types";
import { resolveTargets } from "@/lib/personas/resolver";
import { planReplay } from "@/lib/conversations/replay";
import * as messagesRepo from "@/lib/persistence/messages";
import { transaction } from "@/lib/persistence/transaction";
import { selectionAfterResolve } from "./sendSelection";
import { runPlannedSend } from "./runPlannedSend";
import type { ReplayMessageDeps } from "./deps";

export interface ReplayMessageArgs {
  conversation: Conversation;
  messageId: string;
  newContent: string;
}

export type ReplayMessageResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function replayMessage(
  deps: ReplayMessageDeps,
  args: ReplayMessageArgs,
): Promise<ReplayMessageResult> {
  const { conversation, messageId, newContent } = args;
  const personas = deps.getPersonas(conversation.id);
  const selection = deps.getSelection(conversation.id);
  const history = deps.getMessages(conversation.id);

  // #92: if the edited text has no explicit @targets, restore the
  // original message's targeting instead of using the current
  // selection.
  const original = history.find((m) => m.id === messageId);
  const originalAddressedTo = original?.addressedTo ?? [];
  let resolved = resolveTargets({
    text: newContent,
    personas: [...personas],
    selection: [...selection],
  });
  if (resolved.mode === "implicit" && original) {
    if (originalAddressedTo.length === 0) {
      resolved = resolveTargets({
        text: `@all ${newContent}`,
        personas: [...personas],
        selection: [...selection],
      });
    } else {
      const prefix = originalAddressedTo
        .map((id) => `@${personas.find((p) => p.id === id)?.nameSlug ?? id}`)
        .join(" ");
      resolved = resolveTargets({
        text: `${prefix} ${newContent}`,
        personas: [...personas],
        selection: [...selection],
      });
    }
  }
  if (resolved.targets.length === 0) {
    return { ok: false, reason: "no targets" };
  }

  // #130: always persist the resolved target list on the user row.
  const addressedTo = resolved.targets.map((t) => t.key);
  const plan = planReplay([...history], messageId, resolved.strippedText, addressedTo);
  if (!plan.ok) return { ok: false, reason: plan.reason };

  // #164: rewrite the user row and drop the trailing assistant rows in
  // one transaction. A failure mid-way otherwise leaves the edit applied
  // with the stale replies still attached.
  const edited = history.find((m) => m.id === messageId);
  await transaction(async () => {
    await messagesRepo.applyMessageMutation({
      id: plan.update.id,
      content: plan.update.content,
      addressedTo: plan.update.addressedTo,
    });
    if (edited) {
      await messagesRepo.deleteMessagesAfter(conversation.id, edited.index);
    }
  });
  await deps.reloadMessages(conversation.id);

  if (resolved.mode !== "implicit") {
    const nextSelection = selectionAfterResolve(resolved, [...selection]);
    deps.setSelection(conversation.id, nextSelection);
  }

  const result = await runPlannedSend(deps, { conversation, resolved, personas });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true };
}
