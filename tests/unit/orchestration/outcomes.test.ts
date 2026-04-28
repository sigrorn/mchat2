// runPlannedSend outcome aggregation — slice 2 of #212 (#214).
//
// runPlannedSend now returns a per-target outcomes array. For DAG
// dispatches, descendants of a failed root cascade to "skipped" via
// dagExecutor's existing skip propagation; the aggregator turns
// plan.nodes' final statuses into outcome entries the caller can act
// on (no more inferring from message-table diffs).
import { describe, it, expect } from "vitest";
import { aggregateDagOutcomes } from "@/lib/orchestration/outcomeAggregation";
import type { DagNode, DagPlan, PersonaTarget } from "@/lib/types";

function target(key: string): PersonaTarget {
  return { provider: "mock", personaId: key, key, displayName: key };
}

function node(
  key: string,
  parents: string[],
  status: DagNode["status"],
): DagNode {
  return { key, target: target(key), parents, children: [], status };
}

function plan(nodes: DagNode[]): DagPlan {
  const map = new Map<string, DagNode>();
  for (const n of nodes) map.set(n.key, n);
  for (const n of nodes) {
    for (const p of n.parents) {
      map.get(p)?.children.push(n.key);
    }
  }
  return { runId: 1, nodes: map, roots: nodes.filter((n) => n.parents.length === 0).map((n) => n.key) };
}

describe("aggregateDagOutcomes (#214)", () => {
  it("emits one outcome per node with skipped descendants of a failed root", () => {
    // a (failed) → b (skipped) → c (skipped); d (completed) parallel.
    const p = plan([
      node("a", [], "failed"),
      node("b", ["a"], "skipped"),
      node("c", ["b"], "skipped"),
      node("d", [], "completed"),
    ]);
    const completed = new Map<string, string>([
      ["a", "msg_a"],
      ["d", "msg_d"],
    ]);
    const outcomes = aggregateDagOutcomes(p, completed);
    expect(outcomes.find((o) => o.targetKey === "a")).toEqual({
      targetKey: "a",
      kind: "failed",
      messageId: "msg_a",
    });
    expect(outcomes.find((o) => o.targetKey === "b")).toEqual({
      targetKey: "b",
      kind: "skipped",
      messageId: null,
    });
    expect(outcomes.find((o) => o.targetKey === "c")).toEqual({
      targetKey: "c",
      kind: "skipped",
      messageId: null,
    });
    expect(outcomes.find((o) => o.targetKey === "d")).toEqual({
      targetKey: "d",
      kind: "completed",
      messageId: "msg_d",
    });
  });

  it("propagates a cancelled node as cancelled (it ran, just got aborted)", () => {
    const p = plan([node("a", [], "completed"), node("b", ["a"], "skipped")]);
    // The DAG executor maps "cancelled" to "skipped" status when it
    // cascades; the outcomes-array kind comes from the recorded outcome
    // map, not the node status. So if `b` was reached and cancelled
    // mid-run, completedMap should hold {"b": cancelled, msgId}.
    const completed = new Map<string, { kind: "completed" | "failed" | "cancelled"; messageId: string }>([
      ["a", { kind: "completed", messageId: "ma" }],
      ["b", { kind: "cancelled", messageId: "mb" }],
    ]);
    const outcomes = aggregateDagOutcomes(p, completed);
    expect(outcomes.find((o) => o.targetKey === "b")).toEqual({
      targetKey: "b",
      kind: "cancelled",
      messageId: "mb",
    });
  });
});
