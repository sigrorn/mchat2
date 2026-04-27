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
import { recordReplay } from "@/lib/orchestration/recordReplay";
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

  // #164: rewrite the user row in a transaction so a partial failure
  // can't leave the message half-edited.
  // #180: trailing assistant rows are no longer deleted; their
  // Attempts get marked superseded after the regeneration completes
  // (recordReplay below), and both the UI's filterSupersededMessages
  // and buildContext's supersededIds filter hide them from rendering
  // and from the next context.
  const edited = history.find((m) => m.id === messageId);
  const supersededAssistantIds = edited
    ? history.filter((m) => m.role === "assistant" && m.index > edited.index).map((m) => m.id)
    : [];
  await transaction(async () => {
    await messagesRepo.applyMessageMutation({
      id: plan.update.id,
      content: plan.update.content,
      addressedTo: plan.update.addressedTo,
    });
    // #206: stamp the trailing assistant rows as superseded so the
    // UI hides them and the context builder skips them. Done inside
    // the transaction with the message edit so a partial failure
    // can't leave the chat half-replaced.
    if (supersededAssistantIds.length > 0) {
      await messagesRepo.markMessagesSuperseded(supersededAssistantIds, Date.now());
    }
  });
  await deps.reloadMessages(conversation.id);

  if (resolved.mode !== "implicit") {
    const nextSelection = selectionAfterResolve(resolved, [...selection]);
    deps.setSelection(conversation.id, nextSelection);
  }

  const result = await runPlannedSend(deps, { conversation, resolved, personas });
  if (!result.ok) return { ok: false, reason: result.reason };

  // #177: parallel-write the replay's side-effects to the new
  // Run/RunTarget/Attempt model. Tolerated to fail silently —
  // the messages table is still authoritative for the UI until #180
  // flips that, so a write hiccup here must not break the replay.
  try {
    const editedIndex = edited?.index;
    const after = deps.getMessages(conversation.id);
    // #180: old assistant rows past the edit are no longer deleted;
    // exclude them by id so newAssistantMessages contains only the
    // freshly-streamed survivors.
    const supersededSet = new Set(supersededAssistantIds);
    const newAssistantMessages =
      editedIndex == null
        ? []
        : after
            .filter(
              (m) =>
                m.role === "assistant" &&
                m.index > editedIndex &&
                !supersededSet.has(m.id),
            )
            .map((m) => ({
              id: m.id,
              personaId: m.personaId,
              targetKey: personas.find((p) => p.id === m.personaId)?.nameSlug ?? m.personaId ?? "",
              provider: m.provider,
              model: m.model,
              content: m.content,
              createdAt: m.createdAt,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              ttftMs: m.ttftMs ?? null,
              streamMs: m.streamMs ?? null,
              errorMessage: m.errorMessage,
              errorTransient: m.errorTransient,
            }));
    await recordReplay({
      conversationId: conversation.id,
      now: Date.now(),
      supersededMessageIds: supersededAssistantIds,
      newAssistantMessages,
    });
  } catch (err) {
    console.warn("recordReplay failed (parallel-write; non-fatal)", err);
  }
  return { ok: true };
}
