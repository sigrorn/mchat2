// ------------------------------------------------------------------
// Component: runPlannedSend
// Responsibility: Run the plan/queue-status/run-targets/reload block
//                 shared between send and replay (#150). Extracted to
//                 kill the ~25 lines that were duplicated in useSend
//                 between the two flows.
// Collaborators: hooks/useSend.ts (sole consumer for now). Will move
//                under src/lib/app/ once #148 lifts runOneTarget's
//                store calls into deps.
// ------------------------------------------------------------------

import type { Conversation, DagNode, Persona, PersonaTarget } from "@/lib/types";
import type { ResolveResult } from "@/lib/personas/resolver";
import { planSend } from "@/lib/orchestration/sendPlanner";
import { executeDag } from "@/lib/orchestration/dagExecutor";
import type { StreamRunOutcome } from "@/lib/orchestration/streamRunner";
import { runOneTarget } from "@/lib/app/runOneTarget";
import { shouldBufferTokens } from "@/lib/app/shouldBufferTokens";
import { useMessagesStore } from "@/stores/messagesStore";
import { useSendStore } from "@/stores/sendStore";
import { useUiStore } from "@/stores/uiStore";
import { makeRunOneTargetDeps } from "./runOneTargetDeps";

export type RunPlannedSendResult =
  | { ok: true; allTargets: readonly PersonaTarget[] }
  | { ok: false; reason: string };

export async function runPlannedSend(args: {
  conversation: Conversation;
  resolved: ResolveResult;
  personas: readonly Persona[];
}): Promise<RunPlannedSendResult> {
  const { conversation, resolved, personas } = args;

  const runId = useSendStore.getState().nextRunId(conversation.id);
  const plan = planSend({
    mode: resolved.mode,
    targets: resolved.targets,
    personas: [...personas],
    runId,
  });
  if (!plan) return { ok: false, reason: "no plan" };

  const multiTarget = plan.kind !== "single";
  const bufferTokens = shouldBufferTokens({
    displayMode: conversation.displayMode,
    multiTarget,
    streamResponses: useUiStore.getState().streamResponses,
  });

  const allTargets: PersonaTarget[] =
    plan.kind === "single"
      ? [plan.target]
      : plan.kind === "parallel"
        ? [...plan.targets]
        : Array.from(plan.plan.nodes.values()).map((n) => n.target);
  for (const t of allTargets) {
    useSendStore.getState().setTargetStatus(conversation.id, t.key, "queued");
  }

  const deps = makeRunOneTargetDeps();
  const runOne = (target: PersonaTarget): Promise<StreamRunOutcome> =>
    runOneTarget(deps, {
      conversation,
      target,
      personas: [...personas],
      runId,
      bufferTokens,
    });

  if (plan.kind === "single") {
    await runOne(plan.target);
  } else if (plan.kind === "parallel") {
    await Promise.all(plan.targets.map(runOne));
  } else {
    await executeDag({
      plan: plan.plan,
      runNode: async (n: DagNode) => {
        const outcome = await runOne(n.target);
        await useMessagesStore.getState().load(conversation.id);
        return outcome.kind;
      },
    });
  }

  await useMessagesStore.getState().load(conversation.id);

  return { ok: true, allTargets };
}
