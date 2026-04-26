// ------------------------------------------------------------------
// Component: runOneTarget (lib/app)
// Responsibility: Single-target send orchestration. Encapsulates the
//                 full setup chain: keychain → extraConfig → trace →
//                 status flip → runStream → token-patch-by-id →
//                 context notice → cleanup. Used by send, retry, and
//                 replay (#58, #117). Originally lived under
//                 src/hooks/; lifted here in #148 with store calls
//                 routed through deps. #168 finishes the inversion —
//                 every formerly-direct import (keychain, settings,
//                 adapter registry, RAF, trace sink, repo append)
//                 now arrives through deps so the use case can be
//                 unit-tested against fakes.
// Collaborators: lib/orchestration/streamRunner, lib/providers/registry,
//                hooks/useSend (wires deps).
// ------------------------------------------------------------------

import type { Conversation, Persona, PersonaTarget, StreamEvent } from "@/lib/types";
import { runStream, modelForTarget, type StreamRunOutcome } from "@/lib/orchestration/streamRunner";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { DEFAULT_RETRY } from "@/lib/orchestration/retryManager";
import type { RunOneTargetDeps } from "./deps";

export interface RunOneTargetInput {
  conversation: Conversation;
  target: PersonaTarget;
  personas: Persona[];
  runId: number;
  bufferTokens: boolean;
}

export async function runOneTarget(
  deps: RunOneTargetDeps,
  input: RunOneTargetInput,
): Promise<StreamRunOutcome> {
  const { conversation, target, personas, runId, bufferTokens } = input;
  const streamId = `${runId}:${target.key}:${Date.now()}`;
  const controller = new AbortController();

  deps.registerStream(conversation.id, {
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
  const history = deps.getMessages(conversation.id);
  const persona = target.personaId ? personas.find((p) => p.id === target.personaId) : null;
  const priorUser = [...history].reverse().find((m) => m.role === "user");
  const audience = priorUser?.addressedTo ?? [];
  const placeholderPromise = deps.appendAssistantPlaceholder({
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

  const baseApiKey = await deps.getApiKey(target.provider);
  const extraConfig = (await deps.resolveExtraConfig(target.provider, persona ?? null)) ?? {};
  // #140 → #171: openai_compat's API key lives in a per-preset
  // keychain slot, not in the registry-keyed slot deps.getApiKey
  // looks up. The resolver returns the right key under
  // `_resolvedApiKey`; use that when present and strip it before
  // the bag reaches the adapter.
  let apiKey = baseApiKey;
  if (target.provider === "openai_compat" && "_resolvedApiKey" in extraConfig) {
    const resolved = (extraConfig as { _resolvedApiKey?: unknown })._resolvedApiKey;
    apiKey = typeof resolved === "string" ? resolved : null;
    delete (extraConfig as Record<string, unknown>)._resolvedApiKey;
  }
  const globalSystemPrompt = await deps.getGlobalSystemPrompt();
  const idleTimeoutMs = await deps.getIdleTimeoutMs();
  const maxAttempts = await deps.getMaxRetryAttempts();
  const retryPolicy = { ...DEFAULT_RETRY, maxAttempts };

  const placeholder = await placeholderPromise;
  deps.appendPlaceholder(placeholder);
  const debugSession = deps.getDebugSession();
  const workingDir = deps.getWorkingDir();
  const slug = persona?.nameSlug ?? target.key;
  const traceSink =
    debugSession.enabled && debugSession.sessionTimestamp && workingDir
      ? deps.makeTraceSink({
          workingDir,
          sessionTimestamp: debugSession.sessionTimestamp,
          conversationId: conversation.id,
          slug,
        })
      : undefined;

  deps.setTargetStatus(conversation.id, target.key, "streaming");

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
      history: [...history],
      adapter: deps.getAdapter(target.provider),
      apiKey,
      model: modelForTarget(target, personas),
      displayMode: conversation.displayMode,
      extraConfig,
      idleTimeoutMs,
      retry: retryPolicy,
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
            deps.getMessages(conversation.id).find((m) => m.id === placeholderId)?.content ?? "";
          deps.patchContent(conversation.id, placeholderId, current + pendingTokens);
          pendingTokens = "";
        };
        return (e: StreamEvent) => {
          if (e.type === "retrying") {
            deps.setTargetStatus(conversation.id, target.key, "retrying");
          }
          if (e.type === "token" && placeholderId) {
            pendingTokens += e.text;
            if (!rafId) rafId = deps.requestFrame(flushTokens);
          }
          if (e.type === "complete" || e.type === "error") {
            if (rafId) deps.cancelFrame(rafId);
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
      void deps.appendNotice(
        conversation.id,
        `context trimmed for ${name} (${modelForTarget(target, personas)}): ${before} to fit the ${PROVIDER_REGISTRY[target.provider].maxContextTokens}-token limit.`,
      );
    }

    return outcome;
  } finally {
    deps.finishStream(conversation.id, streamId);
    deps.clearTargetStatus(conversation.id, target.key);
  }
}
