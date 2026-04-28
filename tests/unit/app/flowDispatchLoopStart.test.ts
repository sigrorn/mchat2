// Dispatch loop wraps to flow.loopStartIndex (#220).
//
// The wrap-to-step-0 stop signal in the dispatch loop becomes
// wrap-to-loopStartIndex. The cycle still pauses at the wrap point so
// the user gets control back, but the cursor lands on the step that
// the user designated as the loop start (not necessarily 0).
import { describe, it, expect } from "vitest";
import { wrapNextIndex } from "@/lib/app/flowDispatch";
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

describe("wrapNextIndex (#220)", () => {
  it("returns the next index when not at end of cycle", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      1,
      0,
    );
    expect(wrapNextIndex(f, 1)).toEqual({ index: 2, wrapped: false });
  });

  it("wraps to loopStartIndex when advancing past the last step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] }, // setup pause
        { kind: "personas", personaIds: ["p_a"] }, // setup
        { kind: "user", personaIds: [] }, // ← loop start
        { kind: "personas", personaIds: ["p_a"] },
      ],
      3,
      2,
    );
    expect(wrapNextIndex(f, 3)).toEqual({ index: 2, wrapped: true });
  });

  it("default loopStartIndex=0 wraps to 0 (today's behaviour)", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      1,
      0,
    );
    expect(wrapNextIndex(f, 1)).toEqual({ index: 0, wrapped: true });
  });
});
