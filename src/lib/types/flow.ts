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
  // #230: optional hidden instruction. When set on a `personas` step,
  // buildContext appends "Step note: <instruction>" to the system
  // prompt of every persona dispatched at this step. Null on user
  // steps and on personas steps without an instruction.
  instruction: string | null;
}

export interface Flow {
  id: string;
  conversationId: string;
  currentStepIndex: number;
  // #220: cycle wraps back to this index (not always 0) when the
  // cursor advances past the last step. Defaults to 0 — preserves
  // today's wrap-to-step-0 behaviour. Steps with sequence < this
  // index act as a one-shot setup phase that runs only on the first
  // cycle.
  loopStartIndex: number;
  steps: FlowStep[];
}

// Used by the editor and `derivedFlowFromRunsAfter` before persistence.
// Steps carry only the personaIds the user picked; ids are assigned
// by the repo on `upsertFlow`.
export interface FlowDraftStep {
  kind: FlowStepKind;
  personaIds: PersonaId[];
  // #230: optional per-step instruction. Empty string and undefined
  // both serialize to NULL on disk; the repo treats them
  // interchangeably as "no instruction."
  instruction?: string | null;
}

export interface FlowDraft {
  currentStepIndex: number;
  // #220: optional. Omitted (or undefined) ⇒ resets to 0 on upsert,
  // matching omit-means-default semantics for every other field
  // here. Pass an explicit value to keep a non-zero loop-start.
  loopStartIndex?: number;
  steps: FlowDraftStep[];
}
