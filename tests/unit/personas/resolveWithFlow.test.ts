// resolveTargetsWithFlow wrapper — slice 4 of #212 (#216).
//
// A wrapper above the pure resolver. When a flow is attached and the
// next step is `personas`, @convo and @all both narrow to that step's
// persona-set. Other modes pass through.
import { describe, it, expect } from "vitest";
import { resolveTargetsWithFlow } from "@/lib/personas/resolveWithFlow";
import { resolveTargets } from "@/lib/personas/resolver";
import type { Flow, Persona } from "@/lib/types";

function persona(id: string, name: string): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "mock",
    name,
    nameSlug: name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

function flow(steps: Array<{ kind: "user" | "personas"; personaIds: string[] }>, cursor: number): Flow {
  return {
    id: "f_1",
    conversationId: "c_1",
    currentStepIndex: cursor,
    loopStartIndex: 0,
    steps: steps.map((s, i) => ({
      id: `s_${i}`,
      flowId: "f_1",
      sequence: i,
      kind: s.kind,
      personaIds: s.personaIds,
    })),
  };
}

describe("resolveTargetsWithFlow (#216)", () => {
  const personas = [persona("p_a", "Alice"), persona("p_b", "Bob"), persona("p_c", "Carol")];

  it("@convo with flow at user step → next personas-step's set", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
      0,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.mode).toBe("convo");
    expect(r.targets.map((t) => t.personaId).sort()).toEqual(["p_a", "p_b"]);
    expect(r.strippedText).toBe("hi");
  });

  it("@convo with no flow → no-op (empty targets, mode preserved)", () => {
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: null, personas });
    expect(r.mode).toBe("convo");
    expect(r.targets).toEqual([]);
  });

  it("@convo when next step is `user` (not personas) → empty targets", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets).toEqual([]);
  });

  it("@all narrows to the flow's next personas-step when active", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
      ],
      0,
    );
    const base = resolveTargets({ text: "@all hi", personas, selection: [] });
    expect(base.targets).toHaveLength(3); // resolver expands to all visible personas
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets.map((t) => t.personaId)).toEqual(["p_b"]);
  });

  it("@all with no flow keeps full visible-persona semantics", () => {
    const base = resolveTargets({ text: "@all hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: null, personas });
    expect(r.targets).toHaveLength(3);
    expect(r.mode).toBe("all");
  });

  it("@x (single persona) is not narrowed and does not advance flow", () => {
    // The wrapper only touches @all and @convo. Targeted sends pass
    // through untouched — the flow stays paused regardless.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
      ],
      0,
    );
    const base = resolveTargets({ text: "@alice hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.mode).toBe("targeted");
    expect(r.targets.map((t) => t.personaId)).toEqual(["p_a"]);
  });

  it("'next personas-step' wraps around end of cycle to step 0", () => {
    // Cursor at last user step → next personas-step is at sequence 1
    // (back to start of cycle).
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      2,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets.map((t) => t.personaId)).toEqual(["p_a"]);
  });

  it("'implicit' mode passes through unchanged even with flow active", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
      ],
      0,
    );
    const base = resolveTargets({ text: "no prefix", personas, selection: ["p_a", "p_c"] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.mode).toBe("implicit");
    expect(r.targets.map((t) => t.personaId).sort()).toEqual(["p_a", "p_c"]);
  });
});
