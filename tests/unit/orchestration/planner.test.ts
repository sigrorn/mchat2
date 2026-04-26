import { describe, it, expect } from "vitest";
import { planSend } from "@/lib/orchestration/sendPlanner";
import { executeDag } from "@/lib/orchestration/dagExecutor";
import type { Persona, PersonaTarget } from "@/lib/types";

function persona(id: string, runsAfter: string[] = [], sortOrder = 0): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "mock",
    name: id,
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder,
    runsAfter,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null,
  };
}

function target(id: string): PersonaTarget {
  return { provider: "mock", personaId: id, key: id, displayName: id };
}

describe("planSend", () => {
  it("single target becomes kind=single", () => {
    const plan = planSend({
      mode: "implicit",
      targets: [target("a")],
      personas: [persona("a")],
      runId: 1,
    });
    expect(plan?.kind).toBe("single");
  });

  it("multi-target 'targeted' mode is always parallel", () => {
    const plan = planSend({
      mode: "targeted",
      targets: [target("a"), target("b")],
      personas: [persona("a"), persona("b", ["a"])],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
  });

  it("'all' with runsAfter produces dag", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("a"), target("b")],
      personas: [persona("a"), persona("b", ["a"])],
      runId: 1,
    });
    expect(plan?.kind).toBe("dag");
    if (plan?.kind === "dag") {
      expect(plan.plan.nodes.get("b")?.parents).toEqual(["a"]);
      expect(plan.plan.roots).toEqual(["a"]);
    }
  });

  it("'all' without runsAfter collapses to parallel", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("a"), target("b")],
      personas: [persona("a"), persona("b")],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
  });

  it("ignores runsAfter edges into personas outside the target set", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("b")],
      personas: [persona("a"), persona("b", ["a"])],
      runId: 1,
    });
    expect(plan?.kind).toBe("single");
  });

  // #117: stable display order — parallel mode sorts targets by persona.sortOrder.
  it("parallel mode returns targets sorted by persona.sortOrder", () => {
    const plan = planSend({
      mode: "targeted",
      targets: [target("c"), target("a"), target("b")],
      personas: [
        persona("a", [], 0),
        persona("b", [], 1),
        persona("c", [], 2),
      ],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
    if (plan?.kind === "parallel") {
      expect(plan.targets.map((t) => t.key)).toEqual(["a", "b", "c"]);
    }
  });

  it("DAG mode lists roots in sortOrder; dispatch visits nodes in sortOrder+topo order", async () => {
    // a (0), c (2) are both roots; b (1) runs after c.
    // Desired display order: a, c, b.
    const plan = planSend({
      mode: "all",
      targets: [target("c"), target("b"), target("a")],
      personas: [
        persona("a", [], 0),
        persona("b", ["c"], 1),
        persona("c", [], 2),
      ],
      runId: 1,
    });
    expect(plan?.kind).toBe("dag");
    if (plan?.kind !== "dag") return;
    // Roots: nodes with no parents, in sortOrder.
    expect(plan.plan.roots).toEqual(["a", "c"]);
    // Dispatch order: execute with a runNode that records the dispatch
    // sequence. Expected: a, c (both root, sortOrder), then b (after c).
    const started: string[] = [];
    await executeDag({
      plan: plan.plan,
      async runNode(n) {
        started.push(n.key);
        return "completed";
      },
    });
    expect(started).toEqual(["a", "c", "b"]);
  });
});
