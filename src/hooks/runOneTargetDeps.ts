// ------------------------------------------------------------------
// Component: runOneTarget deps factory
// Responsibility: Wire the React/Zustand stores into the
//                 RunOneTargetDeps shape that lib/app/runOneTarget
//                 expects (#148). Lives under src/hooks/ because it
//                 is React-coupled glue; the use case itself stays
//                 boundary-clean.
// Collaborators: lib/app/runOneTarget.ts, stores/messagesStore,
//                stores/sendStore, stores/uiStore.
// ------------------------------------------------------------------

import type { RunOneTargetDeps } from "@/lib/app/deps";
import { useMessagesStore } from "@/stores/messagesStore";
import { useSendStore } from "@/stores/sendStore";
import { useUiStore } from "@/stores/uiStore";

const EMPTY: readonly never[] = Object.freeze([]) as readonly never[];

export function makeRunOneTargetDeps(): RunOneTargetDeps {
  return {
    getMessages: (conversationId) =>
      useMessagesStore.getState().byConversation[conversationId] ?? EMPTY,
    appendPlaceholder: (msg) => useMessagesStore.getState().append(msg),
    patchContent: (conversationId, messageId, content) =>
      useMessagesStore.getState().patchContent(conversationId, messageId, content),
    patchError: (conversationId, messageId, info) =>
      useMessagesStore
        .getState()
        .patchError(conversationId, messageId, info.errorMessage, info.errorTransient),
    appendNotice: (conversationId, content) =>
      useMessagesStore.getState().appendNotice(conversationId, content),
    nextRunId: (conversationId) => useSendStore.getState().nextRunId(conversationId),
    registerStream: (conversationId, stream) =>
      useSendStore.getState().registerStream(conversationId, stream),
    finishStream: (conversationId, streamId) =>
      useSendStore.getState().finishStream(conversationId, streamId),
    setTargetStatus: (conversationId, key, status) =>
      useSendStore.getState().setTargetStatus(conversationId, key, status),
    clearTargetStatus: (conversationId, key) =>
      useSendStore.getState().clearTargetStatus(conversationId, key),
    getStreamResponses: () => useUiStore.getState().streamResponses,
    getDebugSession: () => useUiStore.getState().debugSession,
    getWorkingDir: () => useUiStore.getState().workingDir,
  };
}
