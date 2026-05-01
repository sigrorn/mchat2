// Auto-sync helper: when the cursor parks at a user-step after a
// flow-advancing send, the conversation's persona selection should
// be updated to match the *next* personas-step's set so the user's
// next implicit follow-up naturally lines up. (#223)
import { describe, it, expect } from "vitest";
import {
  nextPersonasStepPersonaIds,
  upcomingStepIndexForPersona,
  flowChainPersonaIds,
  upcomingPersonasStep,
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
      instruction: null,
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

// #227 — when a flow dispatch chains through multiple personas-steps,
// the user message's addressedTo must cover every persona that will
// run, so each chained persona can see the user message + prior chain
// replies. flowChainPersonaIds returns that union set.
describe("flowChainPersonaIds (#227)", () => {
  it("collects all personas across consecutive personas-steps from a user-step cursor", () => {
    // Mirrors the employment-tax-incentives snapshot:
    //   user → claudio → geppetto → claudio → geppetto → claudio → geppetto
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_claudio"] },
        { kind: "personas", personaIds: ["p_geppetto"] },
        { kind: "personas", personaIds: ["p_claudio"] },
        { kind: "personas", personaIds: ["p_geppetto"] },
        { kind: "personas", personaIds: ["p_claudio"] },
        { kind: "personas", personaIds: ["p_geppetto"] },
      ],
      0,
    );
    const ids = flowChainPersonaIds(f);
    expect(ids.sort()).toEqual(["p_claudio", "p_geppetto"]);
  });

  it("stops at the next user-step (does not include personas past it)", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_b"] },
      ],
      0,
    );
    expect(flowChainPersonaIds(f)).toEqual(["p_a"]);
  });

  it("returns the cursor's own step set when cursor is on a personas-step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a", "p_b"] },
      ],
      1,
    );
    expect(flowChainPersonaIds(f).sort()).toEqual(["p_a", "p_b"]);
  });

  it("respects loop_start when wrapping past the last step", () => {
    // cursor at trailing user-step; chain wraps to loop_start and walks
    // through the cycling personas-steps until it would hit the cursor
    // again (full cycle's worth of personas-steps).
    const f = flow(
      [
        { kind: "user", personaIds: [] }, // setup user
        { kind: "personas", personaIds: ["p_setup"] }, // setup personas
        { kind: "user", personaIds: [] }, // ← loop start
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] }, // cursor parks here at end of cycle
      ],
      5,
      2,
    );
    // Walking from 5 → wrap to loop_start (2) → step 2 is user (stops).
    // So no personas in chain. (Edge case: loop_start lands on a user.)
    expect(flowChainPersonaIds(f)).toEqual([]);
  });

  it("walks through wrap into the loop-start range when the wrap target is a personas-step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] }, // setup user
        { kind: "personas", personaIds: ["p_a"] }, // ← loop start
        { kind: "personas", personaIds: ["p_b"] },
        { kind: "user", personaIds: [] }, // cursor parks here
      ],
      3,
      1,
    );
    // From cursor 3 → wrap to loop_start 1 → personas p_a → 2 → personas p_b → 3 → wrap → 1 → already seen, stop.
    expect(flowChainPersonaIds(f).sort()).toEqual(["p_a", "p_b"]);
  });

  it("deduplicates personas appearing in multiple steps", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "personas", personaIds: ["p_b"] },
      ],
      0,
    );
    expect(flowChainPersonaIds(f).sort()).toEqual(["p_a", "p_b"]);
  });

  it("returns empty array for an empty flow", () => {
    const f = flow([], 0);
    expect(flowChainPersonaIds(f)).toEqual([]);
  });
});

// #234 — replayMessage needs the *step id* of the personas-step that
// will run, not just its persona-ids, so it can stamp recordReplay's
// flow_step_id. upcomingPersonasStep returns the FlowStep itself
// (or null) — a small wrapper around the same walker as
// nextPersonasStepPersonaIds.
describe("upcomingPersonasStep (#234)", () => {
  it("returns the upcoming personas-step from a user-step cursor", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    const step = upcomingPersonasStep(f);
    expect(step?.id).toBe("s_1");
    expect(step?.kind).toBe("personas");
  });

  it("returns the cursor's own step when cursor is on a personas-step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "personas", personaIds: ["p_a"] },
      ],
      1,
    );
    expect(upcomingPersonasStep(f)?.id).toBe("s_1");
  });

  it("respects loopStartIndex when wrapping past the last step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] }, // setup user
        { kind: "personas", personaIds: ["p_setup"] }, // setup personas
        { kind: "user", personaIds: [] }, // ← loop start
        { kind: "personas", personaIds: ["p_loop"] },
        { kind: "user", personaIds: [] }, // cursor here
      ],
      4,
      2,
    );
    expect(upcomingPersonasStep(f)?.id).toBe("s_3");
  });

  it("returns null when the cycle has no personas-step", () => {
    const f = flow(
      [
        { kind: "user", personaIds: [] },
        { kind: "user", personaIds: [] },
      ],
      0,
    );
    expect(upcomingPersonasStep(f)).toBeNull();
  });

  it("returns null for an empty flow", () => {
    const f = flow([], 0);
    expect(upcomingPersonasStep(f)).toBeNull();
  });
});
