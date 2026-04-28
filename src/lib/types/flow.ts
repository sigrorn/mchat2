// ------------------------------------------------------------------
// Component: Flow types (#215, slice 3 of #212)
// Responsibility: Per-conversation cyclic flow definition. A flow is
//                 an ordered list of steps; each step is either `user`
//                 (pause for input) or `personas` (parallel set of
//                 personas that all run before the flow advances).
//                 The flow loops back to step 0 after the last step.
// Collaborators: lib/persistence/flows (repo), lib/flows/derivation
//                (pure level-grouping helper), lib/app/sendMessage
//                (cursor advancement, slice 5).
// ------------------------------------------------------------------

import type { PersonaId } from "./persona";

export type FlowStepKind = "user" | "personas";

export interface FlowStep {
  id: string;
  flowId: string;
  sequence: number;
  kind: FlowStepKind;
  // Empty for `user` steps; non-empty for `personas` steps.
  personaIds: PersonaId[];
}

export interface Flow {
  id: string;
  conversationId: string;
  currentStepIndex: number;
  steps: FlowStep[];
}

// Used by the editor and `derivedFlowFromRunsAfter` before persistence.
// Steps carry only the personaIds the user picked; ids are assigned
// by the repo on `upsertFlow`.
export interface FlowDraftStep {
  kind: FlowStepKind;
  personaIds: PersonaId[];
}

export interface FlowDraft {
  currentStepIndex: number;
  steps: FlowDraftStep[];
}
