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
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY, APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import { makeTraceFileSink } from "@/lib/tracing/traceFileSink";
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

  const apiKey = PROVIDER_REGISTRY[target.provider].requiresKey
    ? await keychain.get(PROVIDER_REGISTRY[target.provider].keychainKey)
    : null;
  const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  const persona = target.personaId ? personas.find((p) => p.id === target.personaId) : null;
  const extraConfig: Record<string, unknown> = {};
  if (target.provider === "apertus") {
    const globalProductId = await getSetting(APERTUS_PRODUCT_ID_KEY);
    const productId = globalProductId?.trim() || persona?.apertusProductId || null;
    if (productId) extraConfig.productId = productId;
  }
  const globalSystemPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);
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

  // #58: capture the placeholder id BEFORE tokens arrive so we patch
  // by specific id, never "the last assistant row". Fixes the parallel-
  // send cross-contamination bug.
  let placeholderId: string | null = null;

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
      signal: controller.signal,
      onPlaceholderCreated: (id) => {
        placeholderId = id;
      },
      onEvent: (e: StreamEvent) => {
        if (e.type === "retrying") {
          useSendStore.getState().setTargetStatus(conversation.id, target.key, "retrying");
        }
        if (e.type === "token" && placeholderId) {
          useMessagesStore
            .getState()
            .patchContent(
              conversation.id,
              placeholderId,
              (useMessagesStore
                .getState()
                .byConversation[conversation.id]?.find((m) => m.id === placeholderId)?.content ??
                "") + e.text,
            );
        }
      },
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
