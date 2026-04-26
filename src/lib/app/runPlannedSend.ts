// ------------------------------------------------------------------
// Component: runPlannedSend (lib/app)
// Responsibility: Run the plan/queue-status/run-targets/reload block
//                 shared between send and replay (#150). Originally
//                 lived under src/hooks/; lifted here in #151 with
//                 store calls routed through deps.
// Collaborators: lib/app/runOneTarget, lib/orchestration/{sendPlanner,
//                dagExecutor}, lib/app/shouldBufferTokens.
// ------------------------------------------------------------------

import type { Conversation, DagNode, Persona, PersonaTarget } from "@/lib/types";
import type { ResolveResult } from "@/lib/personas/resolver";
import { planSend } from "@/lib/orchestration/sendPlanner";
import { executeDag } from "@/lib/orchestration/dagExecutor";
import type { StreamRunOutcome } from "@/lib/orchestration/streamRunner";
import { runOneTarget } from "./runOneTarget";
import { shouldBufferTokens } from "./shouldBufferTokens";
import type { RunPlannedSendDeps } from "./deps";

export type RunPlannedSendResult =
  | { ok: true; allTargets: readonly PersonaTarget[] }
  | { ok: false; reason: string };

export async function runPlannedSend(
  deps: RunPlannedSendDeps,
  args: {
    conversation: Conversation;
    resolved: ResolveResult;
    personas: readonly Persona[];
  },
): Promise<RunPlannedSendResult> {
  const { conversation, resolved, personas } = args;

  const runId = deps.nextRunId(conversation.id);
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
    streamResponses: deps.getStreamResponses(),
  });

  const allTargets: PersonaTarget[] =
    plan.kind === "single"
      ? [plan.target]
      : plan.kind === "parallel"
        ? [...plan.targets]
        : Array.from(plan.plan.nodes.values()).map((n) => n.target);
  for (const t of allTargets) {
    deps.setTargetStatus(conversation.id, t.key, "queued");
  }

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
        await deps.reloadMessages(conversation.id);
        return outcome.kind;
      },
    });
  }

  await deps.reloadMessages(conversation.id);

  return { ok: true, allTargets };
}
