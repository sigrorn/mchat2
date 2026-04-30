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

import type { Flow } from "../types";

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
