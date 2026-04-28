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

  // #221: gate on the resolved mode, not on target count. Only the
  // explicit flow-aware tokens (@convo, @all) interact with the cursor.
  // @persona / no-prefix (implicit) / @others stay out of the flow
  // even when their target set happens to match the next step. The
  // original count-based check (#216 / #217) blocked single-persona
  // steps from being flow-managed altogether — a real bug for NVC-
  // style flows where steps alternate single personas.
  if (mode !== "convo" && mode !== "all") {
    return { shouldDispatchAsFlow: false };
  }

  const currentStep = flow.steps[flow.currentStepIndex];
  if (!currentStep || currentStep.kind !== "user") {
    return { shouldDispatchAsFlow: false };
  }

  if (flow.steps.length === 0) return { shouldDispatchAsFlow: false };
  const nextIndex = (flow.currentStepIndex + 1) % flow.steps.length;
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
