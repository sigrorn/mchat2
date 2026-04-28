// ------------------------------------------------------------------
// Component: command deps factory
// Responsibility: Wire React/Zustand stores into the CommandDeps
//                 shape that lib/commands/handlers/* expects (#154).
// Collaborators: lib/commands/dispatch.ts (CommandContext.deps).
// ------------------------------------------------------------------

import type { CommandDeps } from "@/lib/app/deps";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useSendStore } from "@/stores/sendStore";
import { readCachedMessages, readCachedPersonas } from "./cacheReaders";

const EMPTY_SUP: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

export function makeCommandDeps(): CommandDeps {
  return {
    getMessages: (conversationId) => readCachedMessages(conversationId),
    getSupersededIds: (conversationId) =>
      useMessagesStore.getState().supersededByConversation[conversationId] ?? EMPTY_SUP,
    getPersonas: (conversationId) => readCachedPersonas(conversationId),
    getSelection: (conversationId) =>
      usePersonasStore.getState().selectionByConversation[conversationId] ?? [],
    appendNotice: (conversationId, content) =>
      useMessagesStore.getState().appendNotice(conversationId, content),
    reloadMessages: (conversationId) => useMessagesStore.getState().load(conversationId),
    setPinned: (conversationId, messageId, pinned) =>
      useMessagesStore.getState().setPinned(conversationId, messageId, pinned),
    setEditing: (conversationId, messageId) =>
      useMessagesStore.getState().setEditing(conversationId, messageId),
    setReplayQueue: (conversationId, queue) =>
      useMessagesStore.getState().setReplayQueue(conversationId, [...queue]),
    setSelection: (conversationId, selection) =>
      usePersonasStore.getState().setSelection(conversationId, [...selection]),
    setLimit: (conversationId, limitMarkIndex) =>
      useConversationsStore.getState().setLimit(conversationId, limitMarkIndex),
    setLimitSize: (conversationId, limitSizeTokens) =>
      useConversationsStore.getState().setLimitSize(conversationId, limitSizeTokens),
    setCompactionFloor: (conversationId, floorIndex) =>
      useConversationsStore.getState().setCompactionFloor(conversationId, floorIndex),
    setDisplayMode: (conversationId, mode) =>
      useConversationsStore.getState().setDisplayMode(conversationId, mode),
    setVisibilityMatrix: (conversationId, matrix) =>
      useConversationsStore.getState().setVisibilityMatrix(conversationId, matrix),
    setVisibilityPreset: (conversationId, mode, personaIds) =>
      useConversationsStore.getState().setVisibilityPreset(conversationId, mode, [...personaIds]),
    setAutocompact: (conversationId, threshold) =>
      useConversationsStore.getState().setAutocompact(conversationId, threshold),
    setTargetStatus: (conversationId, key, status) =>
      useSendStore.getState().setTargetStatus(conversationId, key, status),
    clearTargetStatus: (conversationId, key) =>
      useSendStore.getState().clearTargetStatus(conversationId, key),
  };
}
