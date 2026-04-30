// Dispatch loop wraps to flow.loopStartIndex (#220).
//
// The wrap-to-step-0 stop signal in the dispatch loop becomes
// wrap-to-loopStartIndex. The cycle still pauses at the wrap point so
// the user gets control back, but the cursor lands on the step that
// the user designated as the loop start (not necessarily 0).
import { describe, it, expect } from "vitest";
import { planFlowDispatch, wrapNextIndex } from "@/lib/app/flowDispatch";
import type { Flow, PersonaTarget } from "@/lib/types";

function target(id: string): PersonaTarget {
  return { provider: "mock", personaId: id, key: id, displayName: id };
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
      instruction: null,
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

// #225 — planFlowDispatch's nextIndex calc must respect loopStartIndex
// when the cursor sits at the last step of the cycle. Without this fix
// the dispatch wraps to step 0 (which is typically a setup user-step
// and fails the personas-kind check), so the send falls through to
// today's runPlannedSend and the flow stalls forever — claudio (the
// auto-synced selection) keeps replying because the cursor never
// advances past the end-of-cycle user step.
describe("planFlowDispatch end-of-cycle wrap (#225)", () => {
  it("wraps to loopStartIndex when cursor is at the last step", () => {
    // Mirrors the reported NVC-coach scenario:
    //   #0 user (setup pause)
    //   #1 personas: claudio  ← loop start
    //   #2 user
    //   #3 personas: nvccoach
    //   #4 user                ← cursor parks here at end of cycle
    const f: Flow = {
      id: "f_1",
      conversationId: "c_1",
      currentStepIndex: 4,
      loopStartIndex: 1,
      steps: [
        { id: "s_0", flowId: "f_1", sequence: 0, kind: "user", personaIds: [], instruction: null },
        { id: "s_1", flowId: "f_1", sequence: 1, kind: "personas", personaIds: ["p_claudio"], instruction: null },
        { id: "s_2", flowId: "f_1", sequence: 2, kind: "user", personaIds: [], instruction: null },
        { id: "s_3", flowId: "f_1", sequence: 3, kind: "personas", personaIds: ["p_nvc"], instruction: null },
        { id: "s_4", flowId: "f_1", sequence: 4, kind: "user", personaIds: [], instruction: null },
      ],
    };
    const plan = planFlowDispatch(f, [target("p_claudio")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(true);
    expect(plan.nextStepIndex).toBe(1); // loopStartIndex, not 0
    expect(plan.nextStep?.id).toBe("s_1");
  });

  it("default loopStartIndex=0 still wraps to 0 (no behaviour change)", () => {
    const f: Flow = {
      id: "f_1",
      conversationId: "c_1",
      currentStepIndex: 1,
      loopStartIndex: 0,
      steps: [
        { id: "s_0", flowId: "f_1", sequence: 0, kind: "personas", personaIds: ["p_a"], instruction: null },
        { id: "s_1", flowId: "f_1", sequence: 1, kind: "user", personaIds: [], instruction: null },
      ],
    };
    const plan = planFlowDispatch(f, [target("p_a")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(true);
    expect(plan.nextStepIndex).toBe(0);
  });
});
