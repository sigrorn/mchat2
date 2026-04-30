// ------------------------------------------------------------------
// Component: flowDispatch (#217, slice 5 of #212)
// Responsibility: Pure helpers that decide whether a send should
//                 flow through the cursor-advancement path or fall
//                 through to today's runPlannedSend. Lifted out of
//                 sendMessage so the decision is independently
//                 testable without faking the entire send pipeline.
// Collaborators: lib/app/sendMessage (consumer).
// ------------------------------------------------------------------

import type { Flow, FlowStep, PersonaTarget, ResolveMode } from "../types";
import type { TargetOutcome } from "../orchestration/outcomeAggregation";

export interface FlowDispatchPlan {
  shouldDispatchAsFlow: boolean;
  // Set when shouldDispatchAsFlow is true. The personas-step that
  // will run; sendMessage advances the cursor to nextStepIndex
  // before dispatching.
  nextStep?: FlowStep;
  nextStepIndex?: number;
}

export function planFlowDispatch(
  flow: Flow | null,
  resolvedTargets: readonly PersonaTarget[],
  mode: ResolveMode,
): FlowDispatchPlan {
  if (!flow) return { shouldDispatchAsFlow: false };

  // #222: only the explicit single-target side-conversation case
  // (\`@persona\` with one target) leaves the flow paused. Everything
  // else — @convo / @all narrowed / multi-target @a,@b / @others /
  // implicit selection — can advance if its target-set matches the
  // next step. This restores the original #216 \"multi-target
  // invocations interact with the flow\" intent that #221's mode-only
  // gate inadvertently overrode, and lets follow-ups at a user-step
  // continue the flow without the user having to type @convo.
  if (mode === "targeted" && resolvedTargets.length === 1) {
    return { shouldDispatchAsFlow: false };
  }

  const currentStep = flow.steps[flow.currentStepIndex];
  if (!currentStep || currentStep.kind !== "user") {
    return { shouldDispatchAsFlow: false };
  }

  if (flow.steps.length === 0) return { shouldDispatchAsFlow: false };
  // #225: wrap via the same helper the dispatch loop uses so the
  // loop_start setup-phase boundary is respected at the user→personas
  // hop too. Plain `(idx + 1) % n` would wrap to step 0, which is
  // typically a setup user-step and fails the personas-kind check below
  // — leaving the flow stalled at end-of-cycle while the auto-synced
  // selection (set via #223) made the same persona reply on every send.
  const nextIndex = wrapNextIndex(flow, flow.currentStepIndex).index;
  const nextStep = flow.steps[nextIndex];
  if (!nextStep || nextStep.kind !== "personas") {
    return { shouldDispatchAsFlow: false };
  }

  if (!setEqualsPersonaIds(nextStep.personaIds, resolvedTargets)) {
    return { shouldDispatchAsFlow: false };
  }

  return { shouldDispatchAsFlow: true, nextStep, nextStepIndex: nextIndex };
}

function setEqualsPersonaIds(
  stepIds: readonly string[],
  targets: readonly PersonaTarget[],
): boolean {
  const stepSet = new Set(stepIds);
  const targetIds = targets.map((t) => t.personaId).filter((id): id is string => !!id);
  if (stepSet.size !== targetIds.length) return false;
  for (const id of targetIds) {
    if (!stepSet.has(id)) return false;
  }
  return true;
}

// Cursor advances iff every outcome is "completed". Any failed,
// cancelled or skipped (cascade) entry keeps the cursor where it is —
// the user can re-type to retry the step.
export function shouldAdvanceCursor(outcomes: readonly TargetOutcome[]): boolean {
  if (outcomes.length === 0) return false;
  return outcomes.every((o) => o.kind === "completed");
}

// #220: compute the next cursor position from the given index. When
// advancing past the last step, wrap to flow.loopStartIndex (which
// defaults to 0). The `wrapped` flag tells callers whether the wrap
// just happened — sendMessage's dispatch loop pauses on wrap so the
// user always gets control back at the cycle boundary, regardless of
// whether the loop start happens to be a personas-step.
export function wrapNextIndex(
  flow: Flow,
  fromIndex: number,
): { index: number; wrapped: boolean } {
  if (flow.steps.length === 0) {
    return { index: 0, wrapped: false };
  }
  const next = fromIndex + 1;
  if (next >= flow.steps.length) {
    return { index: flow.loopStartIndex, wrapped: true };
  }
  return { index: next, wrapped: false };
}
