// ------------------------------------------------------------------
// Component: sendMessage deps factory
// Responsibility: Wire the React/Zustand stores into the
//                 SendMessageDeps shape that lib/app/sendMessage
//                 expects (#151). Composes the deps from
//                 makeRunPlannedSendDeps + makePostResponseCheckDeps
//                 and adds the small SendMessage-only fields.
// Collaborators: lib/app/sendMessage.ts.
// ------------------------------------------------------------------

import type { SendMessageDeps } from "@/lib/app/deps";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { makeRunPlannedSendDeps } from "./runOneTargetDeps";
import { makePostResponseCheckDeps } from "./postResponseCheckDeps";

export function makeSendMessageDeps(): SendMessageDeps {
  return {
    ...makeRunPlannedSendDeps(),
    ...makePostResponseCheckDeps(),
    setSelection: (conversationId, selection) =>
      usePersonasStore.getState().setSelection(conversationId, [...selection]),
    appendUserMessage: async (args) => {
      // The store action returns the persisted Message, but the use
      // case doesn't need it — discard the result so the dep type
      // (Promise<void>) is honest.
      await useMessagesStore.getState().sendUserMessage({
        conversationId: args.conversationId,
        content: args.content,
        addressedTo: [...args.addressedTo],
        pinned: args.pinned,
      });
    },
    rename: (conversationId, title) =>
      useConversationsStore.getState().rename(conversationId, title),
  };
}
