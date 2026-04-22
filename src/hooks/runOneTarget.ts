// ------------------------------------------------------------------
// Component: runOneTarget
// Responsibility: Single-target send orchestration extracted from
//                 useSend (#58). Encapsulates the full setup chain:
//                 keychain → extraConfig → trace → status flip →
//                 runStream → token-patch-by-id → context notice →
//                 cleanup. Used by send, retry, and replay so the
//                 same logic isn't duplicated three times.
// Collaborators: hooks/useSend.ts.
// ------------------------------------------------------------------

import type { Conversation, Persona, PersonaTarget, StreamEvent } from "@/lib/types";
import { runStream, modelForTarget, type StreamRunOutcome } from "@/lib/orchestration/streamRunner";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { resolveExtraConfig } from "@/lib/providers/extraConfig";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "@/lib/settings/keys";
import { makeTraceFileSink } from "@/lib/tracing/traceFileSink";
import * as messagesRepo from "@/lib/persistence/messages";
import { useUiStore } from "@/stores/uiStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { useSendStore } from "@/stores/sendStore";

export interface RunOneTargetInput {
  conversation: Conversation;
  target: PersonaTarget;
  personas: Persona[];
  runId: number;
  bufferTokens: boolean;
}

export async function runOneTarget(input: RunOneTargetInput): Promise<StreamRunOutcome> {
  const { conversation, target, personas, runId, bufferTokens } = input;
  const streamId = `${runId}:${target.key}:${Date.now()}`;
  const controller = new AbortController();

  useSendStore.getState().registerStream(conversation.id, {
    streamId,
    controller,
    target: target.key,
    startedAt: Date.now(),
  });

  // #117: pre-append the placeholder row SYNCHRONOUSLY (before any
  // await below) so multi-persona sends get a deterministic display
  // order matching the caller's target array. messagesRepo.appendMessage
  // is async but has no awaits in its body — it returns a promise that
  // chains via a per-conversation appendChain, so siblings calling it
  // in Promise.all/map order enqueue in that same order and get
  // contiguous indices.
  const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  const persona = target.personaId ? personas.find((p) => p.id === target.personaId) : null;
  const priorUser = [...history].reverse().find((m) => m.role === "user");
  const audience = priorUser?.addressedTo ?? [];
  const placeholderPromise = messagesRepo.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    provider: target.provider,
    model: modelForTarget(target, personas),
    personaId: target.personaId,
    displayMode: conversation.displayMode,
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience,
  });

  const apiKey = PROVIDER_REGISTRY[target.provider].requiresKey
    ? await keychain.get(PROVIDER_REGISTRY[target.provider].keychainKey)
    : null;
  const extraConfig = (await resolveExtraConfig(target.provider, persona ?? null)) ?? {};
  const globalSystemPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);

  const placeholder = await placeholderPromise;
  useMessagesStore.getState().append(placeholder);
  const { debugSession, workingDir } = useUiStore.getState();
  const slug = persona?.nameSlug ?? target.key;
  const traceSink =
    debugSession.enabled && debugSession.sessionTimestamp && workingDir
      ? makeTraceFileSink({
          workingDir,
          sessionTimestamp: debugSession.sessionTimestamp,
          conversationId: conversation.id,
          slug,
        })
      : undefined;

  useSendStore.getState().setTargetStatus(conversation.id, target.key, "streaming");

  // #58/#117: placeholder is already pre-appended and in the store;
  // patch by its specific id, never "the last assistant row".
  const placeholderId: string = placeholder.id;

  try {
    const outcome = await runStream({
      globalSystemPrompt,
      ...(traceSink ? { traceSink } : {}),
      streamId,
      conversation,
      target,
      personas,
      history,
      adapter: adapterFor(target.provider),
      apiKey,
      model: modelForTarget(target, personas),
      displayMode: conversation.displayMode,
      extraConfig,
      bufferTokens,
      placeholderId,
      signal: controller.signal,
      onEvent: (() => {
        let pendingTokens = "";
        let rafId = 0;
        const flushTokens = (): void => {
          rafId = 0;
          if (!placeholderId || !pendingTokens) return;
          const current =
            useMessagesStore
              .getState()
              .byConversation[conversation.id]?.find((m) => m.id === placeholderId)?.content ?? "";
          useMessagesStore.getState().patchContent(conversation.id, placeholderId, current + pendingTokens);
          pendingTokens = "";
        };
        return (e: StreamEvent) => {
          if (e.type === "retrying") {
            useSendStore.getState().setTargetStatus(conversation.id, target.key, "retrying");
          }
          if (e.type === "token" && placeholderId) {
            pendingTokens += e.text;
            if (!rafId) rafId = requestAnimationFrame(flushTokens);
          }
          if (e.type === "complete" || e.type === "error") {
            if (rafId) cancelAnimationFrame(rafId);
            flushTokens();
          }
        };
      })(),
    });

    if (outcome.contextDropped > 0) {
      const name = persona?.name ?? target.displayName;
      const before = outcome.contextFirstSurviving
        ? `dropped messages before #${outcome.contextFirstSurviving}`
        : `dropped ${outcome.contextDropped} oldest message${outcome.contextDropped === 1 ? "" : "s"}`;
      void useMessagesStore
        .getState()
        .appendNotice(
          conversation.id,
          `context trimmed for ${name} (${modelForTarget(target, personas)}): ${before} to fit the ${PROVIDER_REGISTRY[target.provider].maxContextTokens}-token limit.`,
        );
    }

    return outcome;
  } finally {
    useSendStore.getState().finishStream(conversation.id, streamId);
    useSendStore.getState().clearTargetStatus(conversation.id, target.key);
  }
}
