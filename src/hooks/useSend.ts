// ------------------------------------------------------------------
// Component: useSend hook
// Responsibility: The UI-facing entry point for 'send this message'.
//                 Ties together resolver, planner, executor, and
//                 runOneTarget. All heavy lifting happens in lib/; this
//                 hook is glue + a tiny bit of store wiring.
// Collaborators: personas/resolver, orchestration/*, stores/*.
// ------------------------------------------------------------------

import { useCallback } from "react";
import type { Conversation, DagNode, Message, Persona, PersonaTarget } from "@/lib/types";
import { resolveTargets } from "@/lib/personas/resolver";
import { planSend } from "@/lib/orchestration/sendPlanner";
import { executeDag } from "@/lib/orchestration/dagExecutor";
import { modelForTarget } from "@/lib/orchestration/streamRunner";
import { buildRetryTarget } from "@/lib/orchestration/retryTarget";
import { planReplay } from "@/lib/conversations/replay";
import { generateTitle } from "@/lib/conversations/autoTitle";
import * as messagesRepo from "@/lib/persistence/messages";
import { adapterFor } from "@/lib/providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { keychain } from "@/lib/tauri/keychain";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useSendStore } from "@/stores/sendStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { selectionAfterResolve } from "./sendSelection";
import { runOneTarget } from "./runOneTarget";

export interface SendOptions {
  pinned?: boolean;
}

export function useSend(conversation: Conversation) {
  const send = useCallback(
    async (text: string, opts: SendOptions = {}) => {
      const personas: Persona[] = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const selection = usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];

      const resolved = resolveTargets({ text, personas, selection });
      if (resolved.unknown.length > 0) {
        return {
          ok: false as const,
          reason: `unknown target${resolved.unknown.length === 1 ? "" : "s"}: ${resolved.unknown.map((u) => `@${u}`).join(", ")}`,
        };
      }
      if (resolved.targets.length === 0) return { ok: false as const, reason: "no targets" };

      if (resolved.mode !== "implicit") {
        const nextSelection = selectionAfterResolve(resolved, selection);
        usePersonasStore.getState().setSelection(conversation.id, nextSelection);
      }

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

      const multiTarget = plan.kind !== "single";
      const bufferTokens = conversation.displayMode === "cols" && multiTarget;

      const allTargets =
        plan.kind === "single"
          ? [plan.target]
          : plan.kind === "parallel"
            ? plan.targets
            : Array.from(plan.plan.nodes.values()).map((n) => n.target);
      for (const t of allTargets) {
        useSendStore.getState().setTargetStatus(conversation.id, t.key, "queued");
      }

      const runOne = (target: PersonaTarget) =>
        runOneTarget({ conversation, target, personas, runId, bufferTokens });

      if (plan.kind === "single") {
        await runOne(plan.target);
      } else if (plan.kind === "parallel") {
        await Promise.all(plan.targets.map(runOne));
      } else {
        await executeDag({
          plan: plan.plan,
          runNode: (n: DagNode) => runOne(n.target).then((o) => o.kind),
        });
      }

      await useMessagesStore.getState().load(conversation.id);

      // #54: auto-title
      if (conversation.title === "New conversation") {
        const freshHistory = useMessagesStore.getState().byConversation[conversation.id] ?? [];
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
                // Silent discard
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
      const personas: Persona[] = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const target = buildRetryTarget(failed, personas);
      if (!target) return { ok: false as const, reason: "no retry target" };

      const runId = useSendStore.getState().nextRunId(conversation.id);
      useSendStore.getState().setTargetStatus(conversation.id, target.key, "queued");

      await runOneTarget({
        conversation,
        target,
        personas,
        runId,
        bufferTokens: false,
      });

      await useMessagesStore.getState().load(conversation.id);
      return { ok: true as const };
    },
    [conversation],
  );

  const replay = useCallback(
    async (messageId: string, newContent: string) => {
      const personas: Persona[] = usePersonasStore.getState().byConversation[conversation.id] ?? [];
      const selection = usePersonasStore.getState().selectionByConversation[conversation.id] ?? [];
      const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];

      const resolved = resolveTargets({ text: newContent, personas, selection });
      if (resolved.targets.length === 0) {
        return { ok: false as const, reason: "no targets" };
      }

      const addressedTo = resolved.mode === "targeted" ? resolved.targets.map((t) => t.key) : [];
      const plan = planReplay(history, messageId, resolved.strippedText, addressedTo);
      if (!plan.ok) return { ok: false as const, reason: plan.reason };

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

      if (resolved.mode !== "implicit") {
        const nextSelection = selectionAfterResolve(resolved, selection);
        usePersonasStore.getState().setSelection(conversation.id, nextSelection);
      }

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

      const runOne = (target: PersonaTarget) =>
        runOneTarget({ conversation, target, personas, runId, bufferTokens });

      if (runPlan.kind === "single") {
        await runOne(runPlan.target);
      } else if (runPlan.kind === "parallel") {
        await Promise.all(runPlan.targets.map(runOne));
      } else {
        await executeDag({
          plan: runPlan.plan,
          runNode: (n: DagNode) => runOne(n.target).then((o) => o.kind),
        });
      }
      await useMessagesStore.getState().load(conversation.id);
      return { ok: true as const };
    },
    [conversation],
  );

  return { send, retry, replay };
}
