// derivedFlowFromRunsAfter — slice 3 of #212 (#215).
//
// Pure level-grouping topological sort: each level becomes one
// `personas` step, separated by `user` steps. The first step is
// always `user`, then alternating personas/user, ending with a `user`
// step (cycle wraps back to step 0).
//
// Phase C of #241 dropped the runs_after column from disk; the
// derivation now takes a transient Map<personaId, parentIds[]>
// alongside the live persona array.
import { describe, it, expect } from "vitest";
import { derivedFlowFromRunsAfter } from "@/lib/flows/derivation";
import type { Persona } from "@/lib/types";

function p(id: string): Persona {
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
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

const empty = new Map<string, readonly string[]>();

function edges(...pairs: [string, string[]][]): Map<string, readonly string[]> {
  const m = new Map<string, readonly string[]>();
  for (const [child, parents] of pairs) m.set(child, parents);
  return m;
}

describe("derivedFlowFromRunsAfter", () => {
  it("single persona with no edges → [user, personas:[a], user]", () => {
    const draft = derivedFlowFromRunsAfter([p("a")], empty);
    expect(draft.steps.map((s) => s.kind)).toEqual(["user", "personas", "user"]);
    expect(draft.steps[1]?.personaIds).toEqual(["a"]);
  });

  it("linear chain a → b → c → three persona-step levels", () => {
    const draft = derivedFlowFromRunsAfter(
      [p("a"), p("b"), p("c")],
      edges(["b", ["a"]], ["c", ["b"]]),
    );
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
    const draft = derivedFlowFromRunsAfter(
      [p("a"), p("b"), p("c"), p("d")],
      edges(["b", ["a"]], ["c", ["a"]], ["d", ["b", "c"]]),
    );
    const personaSteps = draft.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(3);
    expect(personaSteps[0]?.personaIds).toEqual(["a"]);
    expect(personaSteps[1]?.personaIds.sort()).toEqual(["b", "c"]);
    expect(personaSteps[2]?.personaIds).toEqual(["d"]);
  });

  it("disconnected components share level 0", () => {
    const draft = derivedFlowFromRunsAfter(
      [p("a"), p("b"), p("x"), p("y")],
      edges(["b", ["a"]], ["y", ["x"]]),
    );
    const personaSteps = draft.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(2);
    expect(personaSteps[0]?.personaIds.sort()).toEqual(["a", "x"]);
    expect(personaSteps[1]?.personaIds.sort()).toEqual(["b", "y"]);
  });

  it("empty input → empty draft (no steps)", () => {
    const draft = derivedFlowFromRunsAfter([], empty);
    expect(draft.steps).toEqual([]);
  });

  it("ignores tombstoned personas", () => {
    const ps = [p("a"), p("b")];
    ps[0]!.deletedAt = 1234;
    const draft = derivedFlowFromRunsAfter(ps, edges(["b", ["a"]]));
    const personaSteps = draft.steps.filter((s) => s.kind === "personas");
    expect(personaSteps).toHaveLength(1);
    expect(personaSteps[0]?.personaIds).toEqual(["b"]);
  });

  it("starts with currentStepIndex = 0 (waiting at the first user step)", () => {
    const draft = derivedFlowFromRunsAfter([p("a"), p("b")], edges(["b", ["a"]]));
    expect(draft.currentStepIndex).toBe(0);
  });
});
