// ------------------------------------------------------------------
// Component: postResponseCheck deps factory
// Responsibility: Wire React/Zustand stores into the
//                 PostResponseCheckDeps shape that lib/app expects
//                 (#149).
// Collaborators: lib/app/postResponseCheck.ts, stores/*Store.ts.
// ------------------------------------------------------------------

import type { PostResponseCheckDeps } from "@/lib/app/deps";
import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";
import { readCachedConversations, readCachedMessages, readCachedPersonas } from "./cacheReaders";

const EMPTY_SUP: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

export function makePostResponseCheckDeps(): PostResponseCheckDeps {
  return {
    getMessages: (conversationId) => readCachedMessages(conversationId),
    getSupersededIds: (conversationId) =>
      useMessagesStore.getState().supersededByConversation[conversationId] ?? EMPTY_SUP,
    appendNotice: (conversationId, content) =>
      useMessagesStore.getState().appendNotice(conversationId, content),
    reloadMessages: (conversationId) => useMessagesStore.getState().load(conversationId),
    getPersonas: (conversationId) => readCachedPersonas(conversationId),
    getSelection: (conversationId) =>
      usePersonasStore.getState().selectionByConversation[conversationId] ?? [],
    getConversation: (conversationId) =>
      readCachedConversations().find((c) => c.id === conversationId),
    setContextWarningsFired: (conversationId, fired) =>
      useConversationsStore.getState().setContextWarningsFired(conversationId, fired),
    setCompactionFloor: (conversationId, index) =>
      useConversationsStore.getState().setCompactionFloor(conversationId, index),
    setTargetStatus: (conversationId, key, status) =>
      useSendStore.getState().setTargetStatus(conversationId, key, status),
    clearTargetStatus: (conversationId, key) =>
      useSendStore.getState().clearTargetStatus(conversationId, key),
    // #168: invert the lone settings read so the use case takes the
    // global system prompt as a dep instead of importing getSetting.
    getGlobalSystemPrompt: () => getSetting(GLOBAL_SYSTEM_PROMPT_KEY),
  };
}
