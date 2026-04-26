// ------------------------------------------------------------------
// Component: postResponseCheck deps factory
// Responsibility: Wire React/Zustand stores into the
//                 PostResponseCheckDeps shape that lib/app expects
//                 (#149).
// Collaborators: lib/app/postResponseCheck.ts, stores/*Store.ts.
// ------------------------------------------------------------------

import type { PostResponseCheckDeps } from "@/lib/app/deps";
import type { Message, Persona } from "@/lib/types";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";

const EMPTY_M: readonly Message[] = Object.freeze([]) as readonly Message[];
const EMPTY_P: readonly Persona[] = Object.freeze([]) as readonly Persona[];

export function makePostResponseCheckDeps(): PostResponseCheckDeps {
  return {
    getMessages: (conversationId) =>
      useMessagesStore.getState().byConversation[conversationId] ?? EMPTY_M,
    appendNotice: (conversationId, content) =>
      useMessagesStore.getState().appendNotice(conversationId, content),
    reloadMessages: (conversationId) => useMessagesStore.getState().load(conversationId),
    getPersonas: (conversationId) =>
      usePersonasStore.getState().byConversation[conversationId] ?? EMPTY_P,
    getSelection: (conversationId) =>
      usePersonasStore.getState().selectionByConversation[conversationId] ?? [],
    getConversation: (conversationId) =>
      useConversationsStore.getState().conversations.find((c) => c.id === conversationId),
    setContextWarningsFired: (conversationId, fired) =>
      useConversationsStore.getState().setContextWarningsFired(conversationId, fired),
    setCompactionFloor: (conversationId, index) =>
      useConversationsStore.getState().setCompactionFloor(conversationId, index),
    setLimit: (conversationId, index) =>
      useConversationsStore.getState().setLimit(conversationId, index),
    setTargetStatus: (conversationId, key, status) =>
      useSendStore.getState().setTargetStatus(conversationId, key, status),
    clearTargetStatus: (conversationId, key) =>
      useSendStore.getState().clearTargetStatus(conversationId, key),
  };
}
