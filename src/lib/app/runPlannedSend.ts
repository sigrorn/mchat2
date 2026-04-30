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
import {
  aggregateDagOutcomes,
  type TargetOutcome,
} from "@/lib/orchestration/outcomeAggregation";
import { runOneTarget } from "./runOneTarget";
import { shouldBufferTokens } from "./shouldBufferTokens";
import type { RunPlannedSendDeps } from "./deps";

export type RunPlannedSendResult =
  | {
      ok: true;
      allTargets: readonly PersonaTarget[];
      // #214: per-target outcomes. Lets sendMessage / a flow wrapper
      // act on the result without diffing the messages table.
      outcomes: readonly TargetOutcome[];
    }
  | { ok: false; reason: string };

export async function runPlannedSend(
  deps: RunPlannedSendDeps,
  args: {
    conversation: Conversation;
    resolved: ResolveResult;
    personas: readonly Persona[];
    // #230: when this dispatch is part of a flow personas-step that
    // has a hidden instruction configured, forward it down to
    // runOneTarget → runStream → buildContext.
    stepInstruction?: string | null;
  },
): Promise<RunPlannedSendResult> {
  const { conversation, resolved, personas, stepInstruction } = args;

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
      stepInstruction: stepInstruction ?? null,
    });

  const outcomes: TargetOutcome[] = [];
  if (plan.kind === "single") {
    const o = await runOne(plan.target);
    outcomes.push({ targetKey: plan.target.key, kind: o.kind, messageId: o.messageId });
  } else if (plan.kind === "parallel") {
    const results = await Promise.all(
      plan.targets.map(async (t): Promise<TargetOutcome> => {
        const o = await runOne(t);
        return { targetKey: t.key, kind: o.kind, messageId: o.messageId };
      }),
    );
    outcomes.push(...results);
  } else {
    const recordedOutcomes = new Map<
      string,
      { kind: "completed" | "failed" | "cancelled"; messageId: string }
    >();
    await executeDag({
      plan: plan.plan,
      runNode: async (n: DagNode) => {
        const outcome = await runOne(n.target);
        recordedOutcomes.set(n.key, {
          kind: outcome.kind,
          messageId: outcome.messageId,
        });
        await deps.reloadMessages(conversation.id);
        return outcome.kind;
      },
    });
    outcomes.push(...aggregateDagOutcomes(plan.plan, recordedOutcomes));
  }

  await deps.reloadMessages(conversation.id);

  return { ok: true, allTargets, outcomes };
}
