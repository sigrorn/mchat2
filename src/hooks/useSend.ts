// ------------------------------------------------------------------
// Component: useSend hook
// Responsibility: The UI-facing entry point for 'send this message'.
//                 Ties together resolver, planner, executor, and
//                 streamRunner. All heavy lifting happens in lib/; this
//                 hook is glue + a tiny bit of store wiring.
// Collaborators: personas/resolver, orchestration/*, stores/*.
// ------------------------------------------------------------------

import { useCallback } from "react";
import type { Conversation, DagNode, Persona, PersonaTarget, StreamEvent } from "@/lib/types";
import { resolveTargets } from "@/lib/personas/resolver";
import { planSend } from "@/lib/orchestration/sendPlanner";
import { executeDag } from "@/lib/orchestration/dagExecutor";
import { runStream, modelForTarget } from "@/lib/orchestration/streamRunner";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
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
      const selection =
        usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];

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

      const runOne = async (target: PersonaTarget): Promise<"completed" | "failed" | "cancelled"> => {
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
        try {
          const outcome = await runStream({
            streamId,
            conversation,
            target,
            personas,
            history,
            adapter: adapterFor(target.provider),
            apiKey,
            model: modelForTarget(target, personas),
            displayMode: conversation.displayMode,
            signal: controller.signal,
            onEvent: (e: StreamEvent) => {
              if (e.type === "token") {
                // Live append to the placeholder row.
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

  return { send };
}
