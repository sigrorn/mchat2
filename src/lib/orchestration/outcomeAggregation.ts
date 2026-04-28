// ------------------------------------------------------------------
// Component: Outcome aggregation (#214)
// Responsibility: Turn a finished DagPlan + a per-key map of recorded
//                 runner outcomes into the per-target outcomes array
//                 runPlannedSend returns. The aggregator is pure —
//                 dagExecutor mutates plan.nodes' status during
//                 execution; here we read those statuses to fill in
//                 the "skipped" entries that never ran (and therefore
//                 have no messageId).
// Collaborators: lib/app/runPlannedSend, lib/orchestration/dagExecutor.
// ------------------------------------------------------------------

import type { DagPlan } from "../types";

export type TargetOutcomeKind = "completed" | "failed" | "cancelled" | "skipped";

export interface TargetOutcome {
  targetKey: string;
  kind: TargetOutcomeKind;
  // Null only when the runner never produced a message — i.e. a
  // descendant skipped because its ancestor failed. Every other
  // kind carries the placeholder/assistant message id that
  // runOneTarget pre-appended.
  messageId: string | null;
}

// completedMap is either:
//   - Map<key, string> if callers only track messageId (kind inferred
//     from plan.nodes.get(key).status — used for the simple flow)
//   - Map<key, { kind, messageId }> if callers tracked the runner's
//     own outcome.kind (cancellation can disagree with the node
//     status — runStream may report "cancelled" but dagExecutor records
//     the node as "skipped" when cancellation cascades).
export function aggregateDagOutcomes(
  plan: DagPlan,
  completedMap:
    | ReadonlyMap<string, string>
    | ReadonlyMap<string, { kind: "completed" | "failed" | "cancelled"; messageId: string }>,
): TargetOutcome[] {
  const out: TargetOutcome[] = [];
  for (const node of plan.nodes.values()) {
    const recorded = completedMap.get(node.key);
    if (recorded === undefined) {
      // Never ran — only possible because a parent failed/cascaded.
      out.push({ targetKey: node.target.key, kind: "skipped", messageId: null });
      continue;
    }
    if (typeof recorded === "string") {
      const kind: TargetOutcomeKind =
        node.status === "completed"
          ? "completed"
          : node.status === "failed"
            ? "failed"
            : node.status === "skipped"
              ? "skipped"
              : "cancelled";
      out.push({ targetKey: node.target.key, kind, messageId: recorded });
    } else {
      out.push({
        targetKey: node.target.key,
        kind: recorded.kind,
        messageId: recorded.messageId,
      });
    }
  }
  return out;
}
