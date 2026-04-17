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
import { planReplay } from "@/lib/conversations/replay";
import { generateTitle } from "@/lib/conversations/autoTitle";
import * as messagesRepo from "@/lib/persistence/messages";
import { useConversationsStore } from "@/stores/conversationsStore";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { getSetting } from "@/lib/persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY, APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";
import { makeTraceFileSink } from "@/lib/tracing/traceFileSink";
import { useUiStore } from "@/stores/uiStore";
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
        // #46: tracing gated by the runtime debug toggle in the sidebar.
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
          // #55: emit a notice when context was truncated so the user
          // knows which model caused it and how much was cut.
          if (outcome.contextDropped > 0) {
            const name = persona?.name ?? target.displayName;
            void useMessagesStore
              .getState()
              .appendNotice(
                conversation.id,
                `context trimmed for ${name} (${modelForTarget(target, personas)}): dropped ${outcome.contextDropped} oldest message${outcome.contextDropped === 1 ? "" : "s"} to fit the ${PROVIDER_REGISTRY[target.provider].maxContextTokens}-token limit.`,
              );
          }
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

      // #54: auto-title — after the first completed exchange in a
      // default-named conversation, fire a hidden background request
      // to generate a short title. Detached (void) so it never blocks.
      if (conversation.title === "New conversation") {
        const freshHistory =
          useMessagesStore.getState().byConversation[conversation.id] ?? [];
        const firstUser = freshHistory.find((m) => m.role === "user" && !m.pinned);
        const firstAssistant = freshHistory.find(
          (m) => m.role === "assistant" && !m.errorMessage && m.content,
        );
        if (firstUser && firstAssistant) {
          const titleTarget = allTargets[0];
          if (titleTarget) {
            void (async () => {
              try {
                const ak = PROVIDER_REGISTRY[titleTarget.provider].requiresKey
                  ? await keychain.get(PROVIDER_REGISTRY[titleTarget.provider].keychainKey)
                  : null;
                const title = await generateTitle(
                  adapterFor(titleTarget.provider),
                  ak,
                  modelForTarget(titleTarget, personas),
                  firstUser.content,
                  firstAssistant.content,
                );
                if (title) {
                  await useConversationsStore.getState().rename(conversation.id, title);
                }
              } catch {
                // Silent discard — title generation failure is not user-facing.
              }
            })();
          }
        }
      }

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
      const { debugSession: ds, workingDir: wd } = useUiStore.getState();
      const slug = persona?.nameSlug ?? target.key;
      const traceSink =
        ds.enabled && ds.sessionTimestamp && wd
          ? makeTraceFileSink({
              workingDir: wd,
              sessionTimestamp: ds.sessionTimestamp,
              conversationId: conversation.id,
              slug,
            })
          : undefined;
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

  const replay = useCallback(
    async (messageId: string, newContent: string) => {
      // #44: edit a user row + truncate everything after it + re-send.
      // The flow mirrors `send` but skips creating a new user row; it
      // updates the existing one in place and re-resolves targets from
      // the new text against the current persona list / selection.
      const personas: Persona[] =
        usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const selection =
        usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];

      const resolved = resolveTargets({ text: newContent, personas, selection });
      if (resolved.targets.length === 0) {
        return { ok: false as const, reason: "no targets" };
      }

      const addressedTo =
        resolved.mode === "targeted" ? resolved.targets.map((t) => t.key) : [];
      const plan = planReplay(history, messageId, resolved.strippedText, addressedTo);
      if (!plan.ok) return { ok: false as const, reason: plan.reason };

      // Mutate the DB: update content + addressedTo on the edited row,
      // delete every row at a later index so the regenerated replies
      // take their place.
      const edited = history.find((m) => m.id === messageId);
      await messagesRepo.applyMessageMutation({
        id: plan.update.id,
        content: plan.update.content,
        addressedTo: plan.update.addressedTo,
      });
      if (edited) {
        await messagesRepo.deleteMessagesAfter(conversation.id, edited.index);
      }
      await useMessagesStore.getState().load(conversation.id);

      // Sticky selection update (same as send).
      if (resolved.mode !== "implicit") {
        const nextSelection = selectionAfterResolve(resolved, selection);
        usePersonasStore.getState().setSelection(conversation.id, nextSelection);
      }

      // Dispatch a fresh runStream for each target — reuses the same
      // plan/DAG logic as send.
      const runId = useSendStore.getState().nextRunId(conversation.id);
      const runPlan = planSend({
        mode: resolved.mode,
        targets: resolved.targets,
        personas,
        runId,
      });
      if (!runPlan) return { ok: false as const, reason: "no plan" };

      const multiTarget = runPlan.kind !== "single";
      const bufferTokens = conversation.displayMode === "cols" && multiTarget;

      const allTargets =
        runPlan.kind === "single"
          ? [runPlan.target]
          : runPlan.kind === "parallel"
            ? runPlan.targets
            : Array.from(runPlan.plan.nodes.values()).map((n) => n.target);
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
        const freshHistory =
          useMessagesStore.getState().byConversation[conversation.id] ?? [];
        const persona = target.personaId ? personas.find((p) => p.id === target.personaId) : null;
        const extraConfig: Record<string, unknown> = {};
        if (target.provider === "apertus") {
          const globalProductId = await getSetting(APERTUS_PRODUCT_ID_KEY);
          const productId = globalProductId?.trim() || persona?.apertusProductId || null;
          if (productId) extraConfig.productId = productId;
        }
        const globalSystemPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);
        const { debugSession: ds2, workingDir: wd2 } = useUiStore.getState();
        const slug = persona?.nameSlug ?? target.key;
        const traceSink =
          ds2.enabled && ds2.sessionTimestamp && wd2
            ? makeTraceFileSink({
                workingDir: wd2,
                sessionTimestamp: ds2.sessionTimestamp,
                conversationId: conversation.id,
                slug,
              })
            : undefined;
        useSendStore.getState().setTargetStatus(conversation.id, target.key, "streaming");
        try {
          const outcome = await runStream({
            globalSystemPrompt,
            ...(traceSink ? { traceSink } : {}),
            streamId,
            conversation,
            target,
            personas,
            history: freshHistory,
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

      if (runPlan.kind === "single") {
        await runOne(runPlan.target);
      } else if (runPlan.kind === "parallel") {
        await Promise.all(runPlan.targets.map(runOne));
      } else {
        await executeDag({
          plan: runPlan.plan,
          runNode: (n: DagNode) => runOne(n.target),
        });
      }
      await useMessagesStore.getState().load(conversation.id);
      return { ok: true as const };
    },
    [conversation],
  );

  return { send, retry, replay };
}
