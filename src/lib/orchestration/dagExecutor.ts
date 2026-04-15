// ------------------------------------------------------------------
// Component: DAG executor
// Responsibility: Run a DagPlan in parallel where possible, respecting
//                 runsAfter edges. Awaits each node's runNode callback
//                 and updates statuses. Children whose ancestors failed
//                 are marked 'skipped' without being invoked.
// Collaborators: orchestration/sendPlanner.ts, streamRunner.ts.
// ------------------------------------------------------------------

import type { DagNode, DagNodeStatus, DagPlan } from "../types";

export type RunNodeOutcome = "completed" | "failed" | "cancelled";

export interface ExecuteDagInput {
  plan: DagPlan;
  // Called once per eligible node. Must return its final outcome.
  // A rejected promise is treated as 'failed'.
  runNode: (node: DagNode) => Promise<RunNodeOutcome>;
  // If true, a 'cancelled' outcome marks unstarted descendants 'skipped'
  // (same as failure). Defaults to true; set false if cancellation
  // should leave descendants runnable on a retry/resume.
  cancelCascades?: boolean;
}

export async function executeDag(input: ExecuteDagInput): Promise<DagPlan> {
  const { plan, runNode } = input;
  const cancelCascades = input.cancelCascades ?? true;

  const pending = new Set<string>();
  const running = new Set<Promise<void>>();
  for (const n of plan.nodes.values()) {
    n.status = "pending";
    pending.add(n.key);
  }

  const setStatus = (key: string, s: DagNodeStatus): void => {
    const n = plan.nodes.get(key);
    if (n) n.status = s;
  };

  const markSubtreeSkipped = (root: string): void => {
    const stack = [root];
    while (stack.length) {
      const key = stack.pop();
      if (!key) continue;
      const n = plan.nodes.get(key);
      if (!n) continue;
      for (const c of n.children) {
        const child = plan.nodes.get(c);
        if (!child) continue;
        if (child.status === "pending") {
          child.status = "skipped";
          pending.delete(c);
          stack.push(c);
        }
      }
    }
  };

  const parentsDone = (n: DagNode): boolean => {
    if (n.parent === null) return true;
    const p = plan.nodes.get(n.parent);
    return p?.status === "completed";
  };

  const parentFailedOrSkipped = (n: DagNode): boolean => {
    if (n.parent === null) return false;
    const p = plan.nodes.get(n.parent);
    return p ? p.status === "failed" || p.status === "skipped" : false;
  };

  const dispatch = (): void => {
    for (const key of [...pending]) {
      const n = plan.nodes.get(key);
      if (!n) continue;
      if (parentFailedOrSkipped(n)) {
        n.status = "skipped";
        pending.delete(key);
        markSubtreeSkipped(key);
        continue;
      }
      if (!parentsDone(n)) continue;
      pending.delete(key);
      n.status = "running";
      const p = (async (): Promise<void> => {
        let outcome: RunNodeOutcome;
        try {
          outcome = await runNode(n);
        } catch {
          outcome = "failed";
        }
        // 'cancelled' has no DagNodeStatus equivalent — record it as
        // 'skipped' when it should cascade, otherwise leave the node
        // pending so a resume can re-run it.
        if (outcome === "cancelled" && !cancelCascades) {
          setStatus(key, "pending");
        } else if (outcome === "cancelled") {
          setStatus(key, "skipped");
          markSubtreeSkipped(key);
        } else {
          setStatus(key, outcome);
          if (outcome === "failed") markSubtreeSkipped(key);
        }
      })().finally(() => {
        running.delete(p);
      });
      running.add(p);
    }
  };

  dispatch();
  while (running.size > 0) {
    await Promise.race(running);
    dispatch();
  }

  return plan;
}
