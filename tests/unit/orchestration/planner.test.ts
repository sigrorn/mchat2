// planSend — Phase B of #241 trimmed this to single + parallel.
// Tests that exercised the runs_after-driven DAG kind were removed;
// what remains is the routing distinction and sortOrder-based stable
// ordering for multi-target sends.
import { describe, it, expect } from "vitest";
import { planSend } from "@/lib/orchestration/sendPlanner";
import type { Persona, PersonaTarget } from "@/lib/types";

function persona(id: string, sortOrder = 0): Persona {
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
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
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

  it("multi-target dispatches flat-parallel", () => {
    const plan = planSend({
      mode: "all",
      targets: [target("a"), target("b")],
      personas: [persona("a"), persona("b")],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
  });

  it("multi-target 'targeted' mode dispatches flat-parallel", () => {
    const plan = planSend({
      mode: "targeted",
      targets: [target("a"), target("b")],
      personas: [persona("a"), persona("b")],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
  });

  // #117: stable display order — parallel mode sorts targets by persona.sortOrder.
  it("parallel mode returns targets sorted by persona.sortOrder", () => {
    const plan = planSend({
      mode: "targeted",
      targets: [target("c"), target("a"), target("b")],
      personas: [persona("a", 0), persona("b", 1), persona("c", 2)],
      runId: 1,
    });
    expect(plan?.kind).toBe("parallel");
    if (plan?.kind === "parallel") {
      expect(plan.targets.map((t) => t.key)).toEqual(["a", "b", "c"]);
    }
  });

  it("returns null on empty targets", () => {
    const plan = planSend({
      mode: "all",
      targets: [],
      personas: [],
      runId: 1,
    });
    expect(plan).toBeNull();
  });
});
