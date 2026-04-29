// Auto-sync helper: when the cursor parks at a user-step after a
// flow-advancing send, the conversation's persona selection should
// be updated to match the *next* personas-step's set so the user's
// next implicit follow-up naturally lines up. (#223)
import { describe, it, expect } from "vitest";
import { nextPersonasStepPersonaIds } from "@/lib/app/flowSelectionSync";
import type { Flow } from "@/lib/types";

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

describe("nextPersonasStepPersonaIds (#223)", () => {
  it("returns the upcoming personas-step's set from a user-step cursor", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    expect(nextPersonasStepPersonaIds(f)).toEqual(["p_a"]);
  });

  it("from a later user-step → the next personas-step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] },
      ],
      2,
    );
    expect(nextPersonasStepPersonaIds(f)).toEqual(["p_b"]);
  });

  it("wraps to loopStartIndex (skipping setup) at end of cycle", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] }, // setup
        { kind: "personas", personaIds: ["p_setup"] }, // setup
        { kind: "user", personaIds: [] }, // ← loop start
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      4,
      2,
    );
    expect(nextPersonasStepPersonaIds(f)).toEqual(["p_a"]);
  });

  it("returns null when no personas-step exists in the cycle", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    expect(nextPersonasStepPersonaIds(f)).toBeNull();
  });

  it("returns null for an empty flow", () => {
    const f = flow([], 0);
    expect(nextPersonasStepPersonaIds(f)).toBeNull();
  });
});
