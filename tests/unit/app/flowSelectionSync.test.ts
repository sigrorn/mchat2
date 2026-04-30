// Auto-sync helper: when the cursor parks at a user-step after a
// flow-advancing send, the conversation's persona selection should
// be updated to match the *next* personas-step's set so the user's
// next implicit follow-up naturally lines up. (#223)
import { describe, it, expect } from "vitest";
import {
  nextPersonasStepPersonaIds,
  upcomingStepIndexForPersona,
} from "@/lib/app/flowSelectionSync";
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

// #226 — for the persona panel's "[step#N]" debug badge: which step
// number does this persona's upcoming dispatch correspond to? Returns
// null when the persona isn't part of the upcoming personas-step.
describe("upcomingStepIndexForPersona (#226)", () => {
  it("returns the cursor's step index when cursor is on a personas-step that includes the persona", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
      1,
    );
    expect(upcomingStepIndexForPersona(f, "p_a")).toBe(1);
    expect(upcomingStepIndexForPersona(f, "p_b")).toBe(1);
  });

  it("returns the next personas-step's index when cursor is on a user-step", () => {
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
    expect(upcomingStepIndexForPersona(f, "p_a")).toBe(1);
    // p_b's upcoming step is #3, but the upcoming dispatch from cursor
    // 0 walks to #1 first (which doesn't include p_b) — so p_b doesn't
    // get a badge until the cursor is past #1.
    expect(upcomingStepIndexForPersona(f, "p_b")).toBeNull();
  });

  it("walks past intervening personas-steps that don't include the persona", () => {
    // Cursor on user-step → walker finds first personas-step (which
    // includes p_a, not p_b). p_b gets no badge yet.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "personas", personaIds: ["p_b"] },
      ],
      0,
    );
    expect(upcomingStepIndexForPersona(f, "p_a")).toBe(1);
    expect(upcomingStepIndexForPersona(f, "p_b")).toBeNull();
  });

  it("respects loopStartIndex when wrapping at end of cycle", () => {
    // NVC scenario: cursor parked at trailing user-step, wrap→loopStart.
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_claudio"] }, // loop start
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_nvc"] },
        { kind: "user", personaIds: [] },
      ],
      4,
      1,
    );
    // Upcoming dispatch is claudio at step 1 (after wrap).
    expect(upcomingStepIndexForPersona(f, "p_claudio")).toBe(1);
    expect(upcomingStepIndexForPersona(f, "p_nvc")).toBeNull();
  });

  it("returns null when persona does not appear in any upcoming personas-step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      0,
    );
    expect(upcomingStepIndexForPersona(f, "p_zzz")).toBeNull();
  });

  it("returns null for an empty flow", () => {
    const f = flow([], 0);
    expect(upcomingStepIndexForPersona(f, "p_a")).toBeNull();
  });
});
