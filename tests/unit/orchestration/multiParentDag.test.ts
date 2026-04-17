// #66 — Multi-parent runsAfter: AND-join DAG dependencies.
import { describe, it, expect } from "vitest";
import { executeDag, type RunNodeOutcome } from "@/lib/orchestration/dagExecutor";
import { planSend } from "@/lib/orchestration/sendPlanner";
import type { DagNode, DagPlan, Persona, PersonaTarget } from "@/lib/types";

function target(key: string): PersonaTarget {
  return { provider: "mock", personaId: key, key, displayName: key };
}

function planFromEdges(edges: Array<[string, string[]]>): DagPlan {
  const nodes = new Map<string, DagNode>();
  for (const [k, parents] of edges) {
    nodes.set(k, {
      key: k,
      target: target(k),
      parents,
      children: [],
      status: "pending",
    });
  }
  for (const [k, parents] of edges) {
    for (const p of parents) {
      const pn = nodes.get(p);
      if (pn) pn.children.push(k);
    }
  }
  const roots = edges.filter(([, p]) => p.length === 0).map(([k]) => k);
  return { runId: 1, nodes, roots };
}

function persona(id: string, runsAfter: string[] = []): Persona {
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
    sortOrder: 0,
    runsAfter,
    deletedAt: null,
    apertusProductId: null,
  };
}

describe("executeDag multi-parent (#66)", () => {
  it("AND-join: child waits for ALL parents to complete", async () => {
    // a ──┐
    //     ├──→ c
    // b ──┘
    const p = planFromEdges([
      ["a", []],
      ["b", []],
      ["c", ["a", "b"]],
    ]);
    const order: string[] = [];
    await executeDag({
      plan: p,
      async runNode(n) {
        await new Promise((r) => setTimeout(r, n.key === "b" ? 20 : 5));
        order.push(n.key);
        return "completed";
      },
    });
    expect(order.indexOf("c")).toBeGreaterThan(order.indexOf("a"));
    expect(order.indexOf("c")).toBeGreaterThan(order.indexOf("b"));
    for (const n of p.nodes.values()) expect(n.status).toBe("completed");
  });

  it("child is skipped if ANY parent fails", async () => {
    const p = planFromEdges([
      ["a", []],
      ["b", []],
      ["c", ["a", "b"]],
    ]);
    const invoked: string[] = [];
    await executeDag({
      plan: p,
      async runNode(n): Promise<RunNodeOutcome> {
        invoked.push(n.key);
        return n.key === "a" ? "failed" : "completed";
      },
    });
    expect(invoked.sort()).toEqual(["a", "b"]);
    expect(p.nodes.get("c")?.status).toBe("skipped");
  });

  it("diamond DAG: d waits for both b and c", async () => {
    //     a
    //    / \
    //   b   c
    //    \ /
    //     d
    const p = planFromEdges([
      ["a", []],
      ["b", ["a"]],
      ["c", ["a"]],
      ["d", ["b", "c"]],
    ]);
    const order: string[] = [];
    await executeDag({
      plan: p,
      async runNode(n) {
        await new Promise((r) => setTimeout(r, 5));
        order.push(n.key);
        return "completed";
      },
    });
    expect(order[0]).toBe("a");
    expect(order.indexOf("d")).toBe(3);
  });
});

describe("planSend multi-parent (#66)", () => {
  it("builds DAG with multi-parent edges", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("a"), target("b"), target("c")],
      personas: [persona("a"), persona("b"), persona("c", ["a", "b"])],
      runId: 1,
    });
    expect(plan?.kind).toBe("dag");
    if (plan?.kind === "dag") {
      const cNode = plan.plan.nodes.get("c");
      expect(cNode?.parents).toEqual(["a", "b"]);
      expect(plan.plan.roots.sort()).toEqual(["a", "b"]);
    }
  });

  it("drops multi-parent edges to personas outside target set", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("b"), target("c")],
      personas: [persona("a"), persona("b"), persona("c", ["a", "b"])],
      runId: 1,
    });
    expect(plan?.kind).toBe("dag");
    if (plan?.kind === "dag") {
      const cNode = plan.plan.nodes.get("c");
      expect(cNode?.parents).toEqual(["b"]);
    }
  });
});
