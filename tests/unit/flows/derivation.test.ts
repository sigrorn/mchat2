// derivedFlowFromRunsAfter — slice 3 of #212 (#215).
//
// Pure level-grouping topological sort: each level becomes one
// `personas` step, separated by `user` steps. The first step is
// always `user`, then alternating personas/user, ending with a `user`
// step (cycle wraps back to step 0). Personas with no edges land at
// level 0.
import { describe, it, expect } from "vitest";
import { derivedFlowFromRunsAfter } from "@/lib/flows/derivation";
import type { Persona } from "@/lib/types";

function p(id: string, runsAfter: string[] = []): Persona {
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
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

describe("derivedFlowFromRunsAfter", () => {
  it("single persona with no edges → [user, personas:[a], user]", () => {
    const draft = derivedFlowFromRunsAfter([p("a")]);
    expect(draft.steps.map((s) => s.kind)).toEqual(["user", "personas", "user"]);
    expect(draft.steps[1]?.personaIds).toEqual(["a"]);
  });

  it("linear chain a → b → c → three persona-step levels", () => {
    const draft = derivedFlowFromRunsAfter([
      p("a"),
      p("b", ["a"]),
      p("c", ["b"]),
    ]);
    expect(draft.steps.map((s) => s.kind)).toEqual([
      "user",
      "personas",
      "user",
      "personas",
      "user",
      "personas",
      "user",
    ]);
    expect(draft.steps[1]?.personaIds).toEqual(["a"]);
    expect(draft.steps[3]?.personaIds).toEqual(["b"]);
    expect(draft.steps[5]?.personaIds).toEqual(["c"]);
  });

  it("diamond a → {b, c} → d collapses parallel siblings into one step", () => {
    const draft = derivedFlowFromRunsAfter([
      p("a"),
      p("b", ["a"]),
      p("c", ["a"]),
      p("d", ["b", "c"]),
    ]);
    // Levels: 0=[a], 1=[b,c], 2=[d]. Three personas-steps interleaved
    // with user steps.
    const personaSteps = draft.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(3);
    expect(personaSteps[0]?.personaIds).toEqual(["a"]);
    expect(personaSteps[1]?.personaIds.sort()).toEqual(["b", "c"]);
    expect(personaSteps[2]?.personaIds).toEqual(["d"]);
  });

  it("disconnected components share level 0", () => {
    // a, x have no edges; b runs after a; y runs after x.
    const draft = derivedFlowFromRunsAfter([
      p("a"),
      p("b", ["a"]),
      p("x"),
      p("y", ["x"]),
    ]);
    const personaSteps = draft.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(2);
    expect(personaSteps[0]?.personaIds.sort()).toEqual(["a", "x"]);
    expect(personaSteps[1]?.personaIds.sort()).toEqual(["b", "y"]);
  });

  it("empty input → empty draft (no steps)", () => {
    const draft = derivedFlowFromRunsAfter([]);
    expect(draft.steps).toEqual([]);
  });

  it("ignores tombstoned personas", () => {
    const ps = [p("a"), p("b", ["a"])];
    ps[0]!.deletedAt = 1234;
    const draft = derivedFlowFromRunsAfter(ps);
    // Only 'b' remains. Its parent 'a' is gone, so b becomes a root.
    const personaSteps = draft.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(1);
    expect(personaSteps[0]?.personaIds).toEqual(["b"]);
  });

  it("starts with currentStepIndex = 0 (waiting at the first user step)", () => {
    const draft = derivedFlowFromRunsAfter([p("a"), p("b", ["a"])]);
    expect(draft.currentStepIndex).toBe(0);
  });
});
