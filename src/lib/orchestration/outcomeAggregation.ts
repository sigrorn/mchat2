// ------------------------------------------------------------------
// Component: Per-target outcome shape (#214)
// Responsibility: Tiny type carried by runPlannedSend so callers can
//                 decide step-advancement / replay routing without
//                 diffing the messages table. Phase B of #241 trimmed
//                 this module from a DAG-aware aggregator down to the
//                 type definitions; the aggregator went away with the
//                 runs_after-driven scheduler.
// Collaborators: lib/app/runPlannedSend, lib/app/flowDispatch.
// ------------------------------------------------------------------

export type TargetOutcomeKind = "completed" | "failed" | "cancelled" | "skipped";

export interface TargetOutcome {
  targetKey: string;
  kind: TargetOutcomeKind;
  // Null only when the runner never produced a message — possible in
  // the legacy DAG path when an ancestor's failure cascaded; today's
  // flat-parallel runs always populate this.
  messageId: string | null;
}
