// ------------------------------------------------------------------
// Component: useSend hook
// Responsibility: The UI-facing entry point for 'send this message'.
//                 Ties together resolver, planner, executor, and
//                 streamRunner. All heavy lifting happens in lib/; this
//                 hook is glue + a tiny bit of store wiring.
// Collaborators: personas/resolver, orchestration/*, stores/*.
// ------------------------------------------------------------------

import { useCallback } from "react";
import type {
  Conversation,
  DagNode,
  Message,
  Persona,
  PersonaTarget,
  StreamEvent,
} from "@/lib/types";
import { resolveTargets } from "@/lib/personas/resolver";
import { planSend } from "@/lib/orchestration/sendPlanner";
import { executeDag } from "@/lib/orchestration/dagExecutor";
import { runStream, modelForTarget } from "@/lib/orchestration/streamRunner";
import { buildRetryTarget } from "@/lib/orchestration/retryTarget";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY, APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import { makeTraceFileSink } from "@/lib/tracing/traceFileSink";
import { isDebugEnabled } from "@/lib/tauri/debugFlag";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";
import { selectionAfterResolve } from "./sendSelection";

export interface SendOptions {
  // When true, the persisted user message has pinned=true. Set by the
  // //pin command path so the message survives later //limit cuts.
  pinned?: boolean;
}

export function useSend(conversation: Conversation) {
  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const personas: Persona[] = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const selection = usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];

      const resolved = resolveTargets({ text, personas, selection });
      if (resolved.targets.length === 0) return { ok: false as const, reason: "no targets" };

      // Sticky selection (#7): an @-addressed run replaces the sidebar
      // selection so the next implicit follow-up still hits the same
      // personas. Implicit sends leave selection alone.
      if (resolved.mode !== "implicit") {
        const nextSelection = selectionAfterResolve(resolved, selection);
        usePersonasStore.getState().setSelection(conversation.id, nextSelection);
      }

      // Manual pins always carry their resolved audience as
      // addressedTo so the visibility filter (rule 6) restricts them
      // to the right personas. Non-pinned 'targeted' sends already
      // do the same; this generalises for 'all' and 'implicit'.
      const addressedTo = opts.pinned
        ? resolved.targets.map((t) => t.key)
        : resolved.mode === "targeted"
          ? resolved.targets.map((t) => t.key)
          : [];

      await useMessagesStore.getState().sendUserMessage({
        conversationId: conversation.id,
        content: resolved.strippedText,
        addressedTo,
        pinned: opts.pinned ?? false,
      });

      const runId = useSendStore.getState().nextRunId(conversation.id);
      const plan = planSend({
        mode: resolved.mode,
        targets: resolved.targets,
        personas,
        runId,
      });
      if (!plan) return { ok: false as const, reason: "no plan" };

      // In cols mode every parallel/dag run buffers tokens until all
      // siblings finish, so the columns reveal together. Single-target
      // sends always stream, mode notwithstanding (#16).
      const multiTarget = plan.kind !== "single";
      const bufferTokens = conversation.displayMode === "cols" && multiTarget;

      // #31: mark every plan target as queued up-front. Single/parallel
      // sends transition straight through to streaming below; only DAG
      // runs leave personas visibly green for any meaningful duration.
      const allTargets =
        plan.kind === "single"
          ? [plan.target]
          : plan.kind === "parallel"
            ? plan.targets
            : Array.from(plan.plan.nodes.values()).map((n) => n.target);
      for (const t of allTargets) {
        useSendStore.getState().setTargetStatus(conversation.id, t.key, "queued");
      }

      const runOne = async (
        target: PersonaTarget,
      ): Promise<"completed" | "failed" | "cancelled"> => {
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
        // Adapter-specific config from the resolved persona (#15).
        // Currently only Apertus reads this; other adapters ignore it.
        const persona = target.personaId ? personas.find((p) => p.id === target.personaId) : null;
        const extraConfig: Record<string, unknown> = {};
        if (target.provider === "apertus") {
          // Global setting (#25) takes precedence; per-persona value is
          // only consulted as back-compat for personas created before
          // the move.
          const globalProductId = await getSetting(APERTUS_PRODUCT_ID_KEY);
          const productId = globalProductId?.trim() || persona?.apertusProductId || null;
          if (productId) extraConfig.productId = productId;
        }
        const globalSystemPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);
        // #40: tracing gated by MCHAT2_DEBUG env var (read once per
        // process), not a persisted setting — keeps the disk-fill
        // foot-gun under explicit per-launch control.
        const traceEnabled = await isDebugEnabled();
        const slug = persona?.nameSlug ?? target.key;
        const traceSink = traceEnabled ? await makeTraceFileSink({ slug }) : undefined;
        // #32: keep the row green (queued) while keychain is unlocking;
        // only flip to streaming right before we open the adapter.
        useSendStore.getState().setTargetStatus(conversation.id, target.key, "streaming");
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
            onEvent: (e: StreamEvent) => {
              if (e.type === "retrying") {
                useSendStore.getState().setTargetStatus(conversation.id, target.key, "retrying");
              }
              if (e.type === "token") {
                // Live append to the placeholder row. The runner
                // already suppresses token events in cols-multi mode.
                const list = useMessagesStore.getState().byConversation[conversation.id] ?? [];
                const last = list[list.length - 1];
                if (last && last.role === "assistant") {
                  useMessagesStore
                    .getState()
                    .patchContent(conversation.id, last.id, last.content + e.text);
                }
              }
            },
          });
          return outcome.kind;
        } finally {
          useSendStore.getState().finishStream(conversation.id, streamId);
          useSendStore.getState().clearTargetStatus(conversation.id, target.key);
        }
      };

      if (plan.kind === "single") {
        await runOne(plan.target);
      } else if (plan.kind === "parallel") {
        await Promise.all(plan.targets.map(runOne));
      } else {
        await executeDag({
          plan: plan.plan,
          runNode: (n: DagNode) => runOne(n.target),
        });
      }
      // Refresh messages from DB so assistant row content matches DB.
      await useMessagesStore.getState().load(conversation.id);
      return { ok: true as const };
    },
    [conversation],
  );

  const retry = useCallback(
    async (failed: Message) => {
      // #43: fire a fresh runStream for a failed assistant row. The
      // placeholder is new (not overwriting the old failed row); the
      // context builder already filters assistant rows with
      // errorMessage !== null, so the failed bubble is invisible to
      // the LLM but stays in the UI as an audit trail.
      const personas: Persona[] =
        usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const target = buildRetryTarget(failed, personas);
      if (!target) {
        return { ok: false as const, reason: "no retry target" };
      }

      const runId = useSendStore.getState().nextRunId(conversation.id);
      const streamId = `${runId}:retry:${target.key}:${Date.now()}`;
      const controller = new AbortController();

      useSendStore.getState().setTargetStatus(conversation.id, target.key, "queued");
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
      const traceEnabled = await isDebugEnabled();
      const slug = persona?.nameSlug ?? target.key;
      const traceSink = traceEnabled ? await makeTraceFileSink({ slug }) : undefined;
      useSendStore.getState().setTargetStatus(conversation.id, target.key, "streaming");

      try {
        await runStream({
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
          signal: controller.signal,
          onEvent: (e: StreamEvent) => {
            if (e.type === "retrying") {
              useSendStore.getState().setTargetStatus(conversation.id, target.key, "retrying");
            }
            if (e.type === "token") {
              const list = useMessagesStore.getState().byConversation[conversation.id] ?? [];
              const last = list[list.length - 1];
              if (last && last.role === "assistant") {
                useMessagesStore
                  .getState()
                  .patchContent(conversation.id, last.id, last.content + e.text);
              }
            }
          },
        });
      } finally {
        useSendStore.getState().finishStream(conversation.id, streamId);
        useSendStore.getState().clearTargetStatus(conversation.id, target.key);
      }

      await useMessagesStore.getState().load(conversation.id);
      return { ok: true as const };
    },
    [conversation],
  );

  return { send, retry };
}
