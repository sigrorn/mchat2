import { describe, it, expect } from "vitest";
import { executeDag, type RunNodeOutcome } from "@/lib/orchestration/dagExecutor";
import type { DagNode, DagPlan, PersonaTarget } from "@/lib/types";

function target(key: string): PersonaTarget {
  return { provider: "mock", personaId: key, key, displayName: key };
}

function plan(edges: Array<[string, string | null]>): DagPlan {
  const nodes = new Map<string, DagNode>();
  for (const [k, parent] of edges) {
    nodes.set(k, {
      key: k,
      target: target(k),
      parents: parent ? [parent] : [],
      children: [],
      status: "pending",
    });
  }
  for (const [k, parent] of edges) {
    if (parent) {
      const p = nodes.get(parent);
      if (p) p.children.push(k);
    }
  }
  const roots = edges.filter(([, p]) => p === null).map(([k]) => k);
  return { runId: 1, nodes, roots };
}

describe("executeDag", () => {
  it("runs roots in parallel then children after parents complete", async () => {
    const p = plan([
      ["a", null],
      ["b", null],
      ["c", "a"],
    ]);
    const order: string[] = [];
    const started: string[] = [];
    await executeDag({
      plan: p,
      async runNode(n) {
        started.push(n.key);
        await new Promise((r) => setTimeout(r, 5));
        order.push(n.key);
        return "completed";
      },
    });
    expect(started.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(order[order.length - 1]).toBe("c");
    for (const n of p.nodes.values()) expect(n.status).toBe("completed");
  });

  it("skips descendants when a parent fails", async () => {
    const p = plan([
      ["a", null],
      ["b", "a"],
      ["c", "b"],
    ]);
    const invoked: string[] = [];
    await executeDag({
      plan: p,
      async runNode(n): Promise<RunNodeOutcome> {
        invoked.push(n.key);
        return n.key === "a" ? "failed" : "completed";
      },
    });
    expect(invoked).toEqual(["a"]);
    expect(p.nodes.get("a")?.status).toBe("failed");
    expect(p.nodes.get("b")?.status).toBe("skipped");
    expect(p.nodes.get("c")?.status).toBe("skipped");
  });

  it("runNode rejection is treated as failed", async () => {
    const p = plan([
      ["a", null],
      ["b", "a"],
    ]);
    await executeDag({
      plan: p,
      async runNode(n) {
        if (n.key === "a") throw new Error("boom");
        return "completed";
      },
    });
    expect(p.nodes.get("a")?.status).toBe("failed");
    expect(p.nodes.get("b")?.status).toBe("skipped");
  });

  it("cancelCascades=false leaves children runnable after cancel", async () => {
    const p = plan([
      ["a", null],
      ["b", "a"],
    ]);
    await executeDag({
      plan: p,
      cancelCascades: false,
      async runNode(n) {
        return n.key === "a" ? "cancelled" : "completed";
      },
    });
    // 'cancelled' outcome with cancelCascades=false maps to status
    // 'pending' so a retry/resume can pick both up cleanly.
    expect(p.nodes.get("a")?.status).toBe("pending");
    expect(p.nodes.get("b")?.status).toBe("pending");
  });
});
