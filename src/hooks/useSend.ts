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
import { modelForTarget } from "@/lib/orchestration/streamRunner";
import { planReplay } from "@/lib/conversations/replay";
import { generateTitle } from "@/lib/conversations/autoTitle";
import * as messagesRepo from "@/lib/persistence/messages";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { selectionAfterResolve } from "@/lib/app/sendSelection";
import { postResponseCheck } from "@/lib/app/postResponseCheck";
import { retryMessage } from "@/lib/app/retryMessage";
import { runPlannedSend } from "./runPlannedSend";
import { makeRetryMessageDeps } from "./runOneTargetDeps";
import { makePostResponseCheckDeps } from "./postResponseCheckDeps";

export interface SendOptions {
  pinned?: boolean;
}

export function useSend(conversation: Conversation) {
  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const personas: Persona[] = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const selection = usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];

      const resolved = resolveTargets({ text, personas, selection });
      if (resolved.unknown.length > 0) {
        return {
          ok: false as const,
          reason: `unknown target${resolved.unknown.length === 1 ? "" : "s"}: ${resolved.unknown.map((u) => `@${u}`).join(", ")}`,
        };
      }
      if (resolved.targets.length === 0) return { ok: false as const, reason: "no targets" };

      if (resolved.mode !== "implicit") {
        const nextSelection = selectionAfterResolve(resolved, selection);
        usePersonasStore.getState().setSelection(conversation.id, nextSelection);
      }

      // #130: always persist the resolved target list. Implicit sends
      // used to store [] here, which made assistant replies' audience
      // empty and broke cols-mode grouping. userHeader keeps the
      // "@all" shorthand when the list covers every active persona.
      const addressedTo = resolved.targets.map((t) => t.key);

      await useMessagesStore.getState().sendUserMessage({
        conversationId: conversation.id,
        content: resolved.strippedText,
        addressedTo,
        pinned: opts.pinned ?? false,
      });

      const result = await runPlannedSend({ conversation, resolved, personas });
      if (!result.ok) return { ok: false as const, reason: result.reason };

      // #105: post-response autocompact / context warnings.
      void postResponseCheck(makePostResponseCheckDeps(), conversation.id);

      // #54: auto-title
      if (conversation.title === "New conversation") {
        const freshHistory = useMessagesStore.getState().byConversation[conversation.id] ?? [];
        const firstUser = freshHistory.find((m) => m.role === "user" && !m.pinned);
        const firstAssistant = freshHistory.find(
          (m) => m.role === "assistant" && !m.errorMessage && m.content,
        );
        if (firstUser && firstAssistant) {
          const titleTarget = result.allTargets[0];
          if (titleTarget) {
            void (async () => {
              try {
                const ak = PROVIDER_REGISTRY[titleTarget.provider].requiresKey
                  ? await keychain.get(PROVIDER_REGISTRY[titleTarget.provider].keychainKey)
                  : null;
                const title = await generateTitle(
                  adapterFor(titleTarget.provider),
                  ak,
                  modelForTarget(titleTarget, personas),
                  firstUser.content,
                  firstAssistant.content,
                );
                if (title) {
                  await useConversationsStore.getState().rename(conversation.id, title);
                }
              } catch {
                // Silent discard
              }
            })();
          }
        }
      }

      return { ok: true as const };
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

      const result = await runPlannedSend({ conversation, resolved, personas });
      if (!result.ok) return { ok: false as const, reason: result.reason };
      return { ok: true as const };
    },
    [conversation],
  );

  return { send, retry, replay };
}
