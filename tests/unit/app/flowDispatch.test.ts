// planFlowDispatch + shouldAdvanceCursor — slice 5 of #212 (#217).
//
// Pure helpers that decide whether sendMessage should take the
// flow-managed path vs. today's runPlannedSend.
import { describe, it, expect } from "vitest";
import {
  planFlowDispatch,
  shouldAdvanceCursor,
} from "@/lib/app/flowDispatch";
import type { Flow, PersonaTarget } from "@/lib/types";
import type { TargetOutcome } from "@/lib/orchestration/outcomeAggregation";

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
    })),
  };
}

function target(id: string): PersonaTarget {
  return { provider: "mock", personaId: id, key: id, displayName: id };
}

describe("planFlowDispatch (#217)", () => {
  it("matches when flow at user-step and resolved set equals next step's set", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a"), target("p_b")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(true);
    expect(plan.nextStepIndex).toBe(1);
    expect(plan.nextStep?.id).toBe("s_1");
  });

  it("no-op when no flow attached", () => {
    const plan = planFlowDispatch(null, [target("p_a")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("no-op when cursor is at a `personas` step (not user)", () => {
    const f = flow(
      [
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("no-op when next step is also a `user` step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("set-equality required: extra target in resolved → no match", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a"), target("p_b")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("set-equality required: missing target in resolved → no match", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("explicit @persona (mode='targeted') does not advance the flow", () => {
    // Single-target via @persona: the user wants to talk to that
    // persona without disturbing the flow. Even if the next step
    // contains only that persona, the cursor stays put.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "targeted");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("@convo with single-persona next step DOES advance the flow (#221)", () => {
    // Bugfix for #221: NVC-style flows alternate single-persona
    // steps. @convo gets narrowed to that single persona by the
    // resolveTargetsWithFlow wrapper; the dispatch gate must use
    // mode (not count) so this case isn't blocked.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "convo");
    expect(plan.shouldDispatchAsFlow).toBe(true);
  });

  it("@all with single-persona next step DOES advance the flow (#221)", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "all");
    expect(plan.shouldDispatchAsFlow).toBe(true);
  });

  it("implicit (no prefix) does not advance the flow even with matching selection (#221)", () => {
    // Implicit means the user typed without an @-prefix and the
    // selection happens to match. Per the original #216 contract,
    // only explicit flow tokens (@convo / @all) advance.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    const plan = planFlowDispatch(f, [target("p_a")], "implicit");
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("@others does not advance the flow (#221)", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
      0,
    );
    const plan = planFlowDispatch(
      f,
      [target("p_a"), target("p_b")],
      "others",
    );
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });

  it("cursor wraps around to next personas step", () => {
    // Cursor at last user step (index 2) → wraps to step 0; if step 0
    // is `user`, dispatch advances to step 1 (personas).
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
        { kind: "user", personaIds: [] },
      ],
      2,
    );
    const plan = planFlowDispatch(f, [target("p_a"), target("p_b")], "convo");
    // From cursor=2 (user), the immediately next step is index 0 (also
    // user) → no match. The wrap-around scan keeps going to find the
    // first non-user, but the contract says only the *immediate* next
    // step counts. Confirm.
    // Per the spec, "advance cursor by one (now at the personas step)"
    // means we expect the index right after current to be the personas
    // step. If the immediate next is also user, no flow dispatch.
    expect(plan.shouldDispatchAsFlow).toBe(false);
  });
});

describe("shouldAdvanceCursor (#217)", () => {
  function outcome(kind: TargetOutcome["kind"]): TargetOutcome {
    return { targetKey: "x", kind, messageId: kind === "skipped" ? null : "m_1" };
  }

  it("advances when every outcome is completed", () => {
    expect(shouldAdvanceCursor([outcome("completed"), outcome("completed")])).toBe(true);
  });

  it("does NOT advance when any outcome failed", () => {
    expect(shouldAdvanceCursor([outcome("completed"), outcome("failed")])).toBe(false);
  });

  it("does NOT advance when any outcome cancelled", () => {
    expect(shouldAdvanceCursor([outcome("completed"), outcome("cancelled")])).toBe(false);
  });

  it("does NOT advance when any outcome skipped (cascaded)", () => {
    expect(shouldAdvanceCursor([outcome("completed"), outcome("skipped")])).toBe(false);
  });

  it("does NOT advance on empty outcomes", () => {
    expect(shouldAdvanceCursor([])).toBe(false);
  });
});
