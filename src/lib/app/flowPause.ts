// ------------------------------------------------------------------
// Component: pauseFlowAt (#233)
// Responsibility: One unit-of-work for "settle the flow at a new
//                 cursor position": persist the cursor, turn
//                 flow_mode on, and auto-sync the conversation's
//                 persona selection to the upcoming personas-step's
//                 set. Lifted out of sendMessage so //pop's rewind
//                 (#232) can reuse the same logic — keeping
//                 selection / flow_mode coherent with the cursor
//                 regardless of whether the move happened via
//                 wrap/pause (sendMessage) or via rewind (handlePop).
// Collaborators: lib/app/sendMessage (post-step / wrap pause),
//                lib/commands/handlers/history (//pop rewind).
// ------------------------------------------------------------------

import type { Flow } from "../types";
import { nextPersonasStepPersonaIds } from "./flowSelectionSync";
import type { FlowWriteDeps, PersonasWriteDeps } from "./deps";

export type PauseFlowDeps = FlowWriteDeps & PersonasWriteDeps;

export async function pauseFlowAt(
  deps: PauseFlowDeps,
  conversationId: string,
  flow: Flow,
  pausedAtIndex: number,
): Promise<void> {
  await deps.setFlowStepIndex(flow.id, pausedAtIndex);
  await deps.setFlowMode(conversationId, true);
  const updated: Flow = { ...flow, currentStepIndex: pausedAtIndex };
  const syncedIds = nextPersonasStepPersonaIds(updated);
  if (syncedIds && syncedIds.length > 0) {
    deps.setSelection(conversationId, syncedIds);
  }
}
