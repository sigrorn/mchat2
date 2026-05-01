// ------------------------------------------------------------------
// Component: flowSelectionSync (#223)
// Responsibility: Pure helper that picks the upcoming personas-step's
//                 persona-id list from a flow's current cursor. Used
//                 by sendMessage's flow path (after a successful
//                 advance) and by the PersonaPanel's "Conversation
//                 flow" toggle to auto-sync the conversation's
//                 persona selection so implicit follow-ups line up
//                 with the next step without the user having to type
//                 @convo.
// Collaborators: lib/app/sendMessage, components/PersonaPanel.
// Pure — no DB access.
// ------------------------------------------------------------------

import type { Flow, FlowStep } from "../types";

// Walk the flow forward from current_step_index and return the first
// `personas` step's persona-id list. Wraps to flow.loopStartIndex
// (skipping the setup phase) just like resolveTargetsWithFlow's
// nextPersonasStep walker. Returns null when the cycle has no
// personas-step at all (e.g. an all-user flow).
export function nextPersonasStepPersonaIds(flow: Flow): string[] | null {
  const n = flow.steps.length;
  if (n === 0) return null;
  const loopStart = flow.loopStartIndex;
  let idx = flow.currentStepIndex;
  for (let i = 0; i < n; i++) {
    const step = flow.steps[idx];
    if (step?.kind === "personas") return [...step.personaIds];
    idx = idx + 1 >= n ? loopStart : idx + 1;
  }
  return null;
}

// #227: collect every persona-id that will run in the upcoming flow
// dispatch chain. Walk forward from cursor through *consecutive*
// personas-steps until we hit a user-step or close the cycle (visiting
// the same index twice via wrap). Used by sendMessage to expand the
// user message's addressedTo so every persona dispatched in the chain
// can see the user message — and via runOneTarget's audience
// derivation, every prior assistant reply in the chain too.
//
// Without this, downstream personas filter the user message out
// (addressedTo gate in builder.ts) and produce vacuous replies —
// poisoning the rest of the chain with no-substance turns.
export function flowChainPersonaIds(flow: Flow): string[] {
  const n = flow.steps.length;
  if (n === 0) return [];
  const loopStart = flow.loopStartIndex;

  // Step we'd dispatch FIRST: if cursor is on a user-step, advance
  // past it to its successor; if cursor is already on a personas-step,
  // start there.
  const cursorStep = flow.steps[flow.currentStepIndex];
  let idx =
    cursorStep?.kind === "user"
      ? flow.currentStepIndex + 1 >= n
        ? loopStart
        : flow.currentStepIndex + 1
      : flow.currentStepIndex;

  const seen = new Set<number>();
  const personaIds = new Set<string>();
  while (!seen.has(idx)) {
    seen.add(idx);
    const step = flow.steps[idx];
    if (!step || step.kind !== "personas") break;
    for (const id of step.personaIds) personaIds.add(id);
    idx = idx + 1 >= n ? loopStart : idx + 1;
  }
  return [...personaIds];
}

// #234: like nextPersonasStepPersonaIds but returns the whole step.
// Used by replayMessage to derive the flow_step_id to stamp on the
// replay run after rewinding the cursor — recordReplay needs the step
// id, not just its persona-ids.
export function upcomingPersonasStep(flow: Flow): FlowStep | null {
  const n = flow.steps.length;
  if (n === 0) return null;
  const loopStart = flow.loopStartIndex;
  let idx = flow.currentStepIndex;
  for (let i = 0; i < n; i++) {
    const step = flow.steps[idx];
    if (step?.kind === "personas") return step;
    idx = idx + 1 >= n ? loopStart : idx + 1;
  }
  return null;
}

// #226: which step index does this persona's *upcoming* dispatch
// correspond to? Used by the panel's [step#N] debug badge so the user
// can see at a glance whether the cursor matches their mental model.
//
// Same walker as nextPersonasStepPersonaIds, but stops at the first
// personas-step (not just any) and only returns its index when the
// queried persona is in that step's set. Personas that appear in a
// later step but not the upcoming one get no badge — clutter-free.
export function upcomingStepIndexForPersona(
  flow: Flow,
  personaId: string,
): number | null {
  const n = flow.steps.length;
  if (n === 0) return null;
  const loopStart = flow.loopStartIndex;
  let idx = flow.currentStepIndex;
  for (let i = 0; i < n; i++) {
    const step = flow.steps[idx];
    if (step?.kind === "personas") {
      return step.personaIds.includes(personaId) ? idx : null;
    }
    idx = idx + 1 >= n ? loopStart : idx + 1;
  }
  return null;
}
