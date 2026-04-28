// resolveTargetsWithFlow respects loopStartIndex when wrapping (#220).
//
// `@convo` walks forward from current_step_index looking for the next
// `personas` step. When it wraps past the end, it should land back at
// loopStartIndex (skipping the setup phase) rather than at 0.
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

function flow(
  steps: Array<{ kind: "user" | "personas"; personaIds: string[] }>,
  cursor: number,
  loopStart = 0,
): Flow {
  return {
    id: "f_1",
    conversationId: "c_1",
    currentStepIndex: cursor,
    loopStartIndex: loopStart,
    steps: steps.map((s, i) => ({
      id: `s_${i}`,
      flowId: "f_1",
      sequence: i,
      kind: s.kind,
      personaIds: s.personaIds,
    })),
  };
}

describe("resolveTargetsWithFlow loopStartIndex (#220)", () => {
  const personas = [persona("p_setup", "Setup"), persona("p_a", "Alice"), persona("p_b", "Bob")];

  it("@convo at end of cycle wraps to the post-setup personas-step", () => {
    // Steps: [user-setup, personas-Setup (one-shot), user, personas-A, user]
    // loopStartIndex = 2. Cursor at 4 (last user step). The next
    // personas step in the cycle should be index 3 (Alice), not 1
    // (the setup persona).
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_setup"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      4,
      2,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets.map((t) => t.personaId)).toEqual(["p_a"]);
  });

  it("@convo before the cycle's tail still finds the next personas-step normally", () => {
    // Cursor at 2 (first user-step inside the loop range). Next
    // personas step is index 3 (Alice) — same as today.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_setup"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      2,
      2,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets.map((t) => t.personaId)).toEqual(["p_a"]);
  });

  it("@convo doesn't revisit the setup phase even when no post-loop personas step exists", () => {
    // Setup phase contains a personas-step; loop range contains only
    // user-steps. From the cycle's tail there's nothing to dispatch
    // to — return empty rather than dipping back into setup.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_setup"] },
        { kind: "user", personaIds: [] },
        { kind: "user", personaIds: [] },
      ],
      3,
      2,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets).toEqual([]);
  });

  it("loopStartIndex=0 keeps today's wrap-to-0 behaviour", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
      0,
    );
    const base = resolveTargets({ text: "@convo hi", personas, selection: [] });
    const r = resolveTargetsWithFlow(base, { flow: f, personas });
    expect(r.targets.map((t) => t.personaId)).toEqual(["p_a"]);
  });
});
