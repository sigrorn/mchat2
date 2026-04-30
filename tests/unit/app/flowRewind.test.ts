// Edit/replay rewind via flow_step_id — slice 7 of #212 (#219).
//
// computeFlowRewindIndex: pure helper. Given a flow + the run rows
// that produced the messages being superseded, find the earliest
// flow step they ran at and return one-before-that-step (the user
// step that fed them). Returns null when no rewind applies.
import { describe, it, expect } from "vitest";
import { computeFlowRewindIndex } from "@/lib/app/flowRewind";
import type { Flow } from "@/lib/types";

function flow(
  steps: Array<{ kind: "user" | "personas"; personaIds: string[] }>,
  cursor: number,
): Flow {
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
      instruction: null,
    })),
  };
}

describe("computeFlowRewindIndex (#219)", () => {
  it("rewinds to the user step that fed the earliest truncated personas-step", () => {
    // Flow: [user, personas-A, user, personas-B, user]
    // Truncate runs that ran at s_3 (personas-B). Rewind to s_2 (user).
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] },
      ],
      4,
    );
    const idx = computeFlowRewindIndex(f, ["s_3"]);
    expect(idx).toBe(2);
  });

  it("multiple truncated steps → rewind to the earliest one's predecessor", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] },
      ],
      4,
    );
    // Editing back to the s_1 step means we also throw away s_3.
    const idx = computeFlowRewindIndex(f, ["s_3", "s_1"]);
    expect(idx).toBe(0);
  });

  it("returns null when none of the runs reference a flow step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    const idx = computeFlowRewindIndex(f, []);
    expect(idx).toBeNull();
  });

  it("ignores unknown flow_step_ids (FK was nulled or step deleted)", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      1,
    );
    const idx = computeFlowRewindIndex(f, ["s_unknown"]);
    expect(idx).toBeNull();
  });

  it("handles step at sequence 0 (no preceding user step) → wraps to last user", () => {
    // Flow starting with personas: [personas-A, user, personas-B, user]
    // Truncating s_0 has no immediately-preceding user — rewind wraps
    // to the last user step (index 3), since the cycle says step 0
    // runs after the last user.
    const f = flow(
      [
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] },
      ],
      3,
    );
    const idx = computeFlowRewindIndex(f, ["s_0"]);
    expect(idx).toBe(3);
  });
});
