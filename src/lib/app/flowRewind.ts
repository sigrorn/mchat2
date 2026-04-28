// ------------------------------------------------------------------
// Component: flowRewind (#219, slice 7 of #212)
// Responsibility: Pure cursor-rewind helper for edit/replay. When a
//                 user message is edited, sendMessage's flow wrapper
//                 needs the cursor positioned BEFORE the personas-
//                 steps whose output is about to be replaced — at the
//                 user step that fed those steps.
// Collaborators: lib/app/replayMessage (consumer), lib/types/flow.
// Pure — no DB access.
// ------------------------------------------------------------------

import type { Flow } from "../types";

// Returns the cursor index to rewind to, or null if no rewind applies
// (no truncated runs reference a flow step we recognize).
//
// Strategy: find the earliest sequence among the truncated steps. The
// rewind target is `sequence - 1` modulo the cycle length — that's
// the step that produced the user input feeding into the truncated
// step. (When the truncated step sits at sequence 0, wrap to the last
// step in the cycle, which is always a `user` step in well-formed
// flows.)
export function computeFlowRewindIndex(
  flow: Flow,
  truncatedFlowStepIds: readonly string[],
): number | null {
  if (truncatedFlowStepIds.length === 0) return null;
  if (flow.steps.length === 0) return null;

  const truncatedSet = new Set(truncatedFlowStepIds);
  let earliest = Infinity;
  for (const step of flow.steps) {
    if (truncatedSet.has(step.id) && step.sequence < earliest) {
      earliest = step.sequence;
    }
  }
  if (earliest === Infinity) return null;

  if (earliest === 0) {
    // Wrap to the last step (the user step that completes the cycle).
    return flow.steps.length - 1;
  }
  return earliest - 1;
}
