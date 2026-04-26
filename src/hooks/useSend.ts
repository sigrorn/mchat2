// ------------------------------------------------------------------
// Component: useSend hook
// Responsibility: The UI-facing entry point for 'send this message'.
//                 Ties together resolver, planner, executor, and
//                 runOneTarget. All heavy lifting happens in lib/; this
//                 hook is glue + a tiny bit of store wiring.
// Collaborators: personas/resolver, orchestration/*, stores/*.
// ------------------------------------------------------------------

import { useCallback } from "react";
import type { Conversation, Message, Persona } from "@/lib/types";
import { resolveTargets } from "@/lib/personas/resolver";
import { planReplay } from "@/lib/conversations/replay";
import * as messagesRepo from "@/lib/persistence/messages";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { selectionAfterResolve } from "@/lib/app/sendSelection";
import { retryMessage } from "@/lib/app/retryMessage";
import { runPlannedSend } from "@/lib/app/runPlannedSend";
import { sendMessage } from "@/lib/app/sendMessage";
import { makeRetryMessageDeps, makeRunPlannedSendDeps } from "./runOneTargetDeps";
import { makeSendMessageDeps } from "./sendMessageDeps";

export interface SendOptions {
  pinned?: boolean;
}

export function useSend(conversation: Conversation) {
  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const result = await sendMessage(makeSendMessageDeps(), {
        conversation,
        text,
        ...(opts.pinned !== undefined ? { pinned: opts.pinned } : {}),
      });
      return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
    },
    [conversation],
  );

  const retry = useCallback(
    async (failed: Message) => {
      const result = await retryMessage(makeRetryMessageDeps(), { conversation, failed });
      return result.ok ? { ok: true as const } : { ok: false as const, reason: result.reason };
    },
    [conversation],
  );

  const replay = useCallback(
    async (messageId: string, newContent: string) => {
      const personas: Persona[] = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const selection = usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];

      // #92: if the edited text has no explicit @targets, restore the
      // original message's targeting instead of using the current selection.
      const original = history.find((m) => m.id === messageId);
      const originalAddressedTo = original?.addressedTo ?? [];
      let resolved = resolveTargets({ text: newContent, personas, selection });
      if (resolved.mode === "implicit" && original) {
        if (originalAddressedTo.length === 0) {
          resolved = resolveTargets({ text: `@all ${newContent}`, personas, selection });
        } else {
          const prefix = originalAddressedTo
            .map((id) => `@${personas.find((p) => p.id === id)?.nameSlug ?? id}`)
            .join(" ");
          resolved = resolveTargets({ text: `${prefix} ${newContent}`, personas, selection });
        }
      }
      if (resolved.targets.length === 0) {
        return { ok: false as const, reason: "no targets" };
      }

      // #130: always persist the resolved target list on the user row.
      const addressedTo = resolved.targets.map((t) => t.key);
      const plan = planReplay(history, messageId, resolved.strippedText, addressedTo);
      if (!plan.ok) return { ok: false as const, reason: plan.reason };

      const edited = history.find((m) => m.id === messageId);
      await messagesRepo.applyMessageMutation({
        id: plan.update.id,
        content: plan.update.content,
        addressedTo: plan.update.addressedTo,
      });
      if (edited) {
        await messagesRepo.deleteMessagesAfter(conversation.id, edited.index);
      }
      await useMessagesStore.getState().load(conversation.id);

      if (resolved.mode !== "implicit") {
        const nextSelection = selectionAfterResolve(resolved, selection);
        usePersonasStore.getState().setSelection(conversation.id, nextSelection);
      }

      const result = await runPlannedSend(makeRunPlannedSendDeps(), {
        conversation,
        resolved,
        personas,
      });
      if (!result.ok) return { ok: false as const, reason: result.reason };
      return { ok: true as const };
    },
    [conversation],
  );

  return { send, retry, replay };
}
