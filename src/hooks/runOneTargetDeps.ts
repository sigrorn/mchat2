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

import type {
  ReplayMessageDeps,
  RetryMessageDeps,
  RunOneTargetDeps,
  RunPlannedSendDeps,
} from "@/lib/app/deps";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";
import { useUiStore } from "@/stores/uiStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { keychain } from "@/lib/tauri/keychain";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { resolveExtraConfig } from "@/lib/providers/extraConfig";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";
import { idleTimeoutMs as idleTimeoutSetting, maxRetryAttempts } from "@/lib/settings/registry";
import { makeTraceFileSink } from "@/lib/tracing/traceFileSink";
import * as messagesRepo from "@/lib/persistence/messages";
import * as flowsRepo from "@/lib/persistence/flows";
import { invalidateRepoQuery } from "@/lib/data/useRepoQuery";
import { readCachedMessages, readCachedPersonas } from "./cacheReaders";

const EMPTY_SUPERSEDED: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

export function makeRunOneTargetDeps(): RunOneTargetDeps {
  return {
    getMessages: (conversationId) => readCachedMessages(conversationId),
    getSupersededIds: (conversationId) =>
      useMessagesStore.getState().supersededByConversation[conversationId] ?? EMPTY_SUPERSEDED,
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
    // #168: infrastructure deps that previously lived as direct
    // imports inside lib/app/runOneTarget.ts.
    getApiKey: async (provider) => {
      const meta = PROVIDER_REGISTRY[provider];
      return meta.requiresKey ? keychain.get(meta.keychainKey) : null;
    },
    getGlobalSystemPrompt: () => getSetting(GLOBAL_SYSTEM_PROMPT_KEY),
    getIdleTimeoutMs: () => idleTimeoutSetting.get(),
    getMaxRetryAttempts: () => maxRetryAttempts.get(),
    getAdapter: (provider) => adapterFor(provider),
    resolveExtraConfig: (provider, persona) => resolveExtraConfig(provider, persona),
    appendAssistantPlaceholder: (args) => messagesRepo.appendMessage(args),
    makeTraceSink: (args) => makeTraceFileSink(args),
    requestFrame: (cb) => globalThis.requestAnimationFrame(cb),
    cancelFrame: (id) => globalThis.cancelAnimationFrame(id),
  };
}

// runPlannedSend = RunOneTargetDeps + reloadMessages.
export function makeRunPlannedSendDeps(): RunPlannedSendDeps {
  return {
    ...makeRunOneTargetDeps(),
    // #263: force-refresh after the post-send sequence (which includes
    // reload calls in branches that mutated DB state).
    reloadMessages: (conversationId) => useMessagesStore.getState().reload(conversationId),
  };
}

// Replay needs runPlannedSend's deps plus persona reads and
// setSelection (no auto-title, no postResponseCheck — narrower than
// SendMessage). #219: also reads/writes the flow cursor so an edit
// can rewind to the user step that fed the truncated runs.
export function makeReplayMessageDeps(): ReplayMessageDeps {
  return {
    ...makeRunPlannedSendDeps(),
    getPersonas: (conversationId) => readCachedPersonas(conversationId),
    getSelection: (conversationId) =>
      usePersonasStore.getState().selectionByConversation[conversationId] ?? [],
    setSelection: (conversationId, selection) =>
      usePersonasStore.getState().setSelection(conversationId, [...selection]),
    getFlow: (conversationId) => flowsRepo.getFlow(conversationId),
    setFlowStepIndex: async (flowId, index) => {
      await flowsRepo.setStepIndex(flowId, index);
      // #223: same as sendMessageDeps — bump the cached flow read so
      // the panel reflects the rewound cursor after a replay.
      invalidateRepoQuery(["flow"]);
    },
    // #223: replay never auto-flips flow_mode (replay is a structural
    // rewind, not a fresh user dispatch). The dep is still required by
    // the FlowWriteDeps slice — wire to the same store action so a
    // future caller could flip it explicitly.
    setFlowMode: (conversationId, on) =>
      useConversationsStore.getState().setFlowMode(conversationId, on),
  };
}

// Retry needs everything runOneTarget needs PLUS getPersonas and
// reloadMessages. Compose at the wiring layer rather than duplicating
// the field list.
export function makeRetryMessageDeps(): RetryMessageDeps {
  return {
    ...makeRunOneTargetDeps(),
    getPersonas: (conversationId) => readCachedPersonas(conversationId),
    getSelection: (conversationId) =>
      usePersonasStore.getState().selectionByConversation[conversationId] ?? [],
    // #263: retry batch deletes prior failed rows then re-fetches —
    // needs force-refresh to drop the deleted rows from the cache.
    reloadMessages: (conversationId) => useMessagesStore.getState().reload(conversationId),
  };
}
