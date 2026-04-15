import { describe, it, expect } from "vitest";
import { planSend } from "@/lib/orchestration/sendPlanner";
import type { Persona, PersonaTarget } from "@/lib/types";

function persona(id: string, runsAfter: string | null = null): Persona {
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
      personas: [persona("a"), persona("b", "a")],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
  });

  it("'all' with runsAfter produces dag", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("a"), target("b")],
      personas: [persona("a"), persona("b", "a")],
      runId: 1,
    });
    expect(plan?.kind).toBe("dag");
    if (plan?.kind === "dag") {
      expect(plan.plan.nodes.get("b")?.parent).toBe("a");
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
      personas: [persona("a"), persona("b", "a")],
      runId: 1,
    });
    expect(plan?.kind).toBe("single");
  });
});
