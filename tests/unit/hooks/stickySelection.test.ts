// Sticky persona selection: an @-addressed send updates the sidebar
// selection, so a follow-up implicit send hits the same targets.
// Issue #7.
import { describe, it, expect } from "vitest";
import { selectionAfterResolve } from "@/hooks/sendSelection";
import type { ResolveResult } from "@/lib/personas/resolver";

function resolved(over: Partial<ResolveResult>): ResolveResult {
  return {
    mode: "implicit",
    targets: [],
    strippedText: "",
    unknown: [],
    ...over,
  };
}

describe("selectionAfterResolve", () => {
  it("targeted: replaces selection with explicit target keys", () => {
    const r = resolved({
      mode: "targeted",
      targets: [
        { provider: "mock", personaId: "p_a", key: "p_a", displayName: "A" },
        { provider: "mock", personaId: "p_b", key: "p_b", displayName: "B" },
      ],
    });
    expect(selectionAfterResolve(r, ["p_other"])).toEqual(["p_a", "p_b"]);
  });

  it("@all: replaces selection with everyone the resolver returned", () => {
    const r = resolved({
      mode: "all",
      targets: [
        { provider: "mock", personaId: "p_a", key: "p_a", displayName: "A" },
        { provider: "mock", personaId: "p_b", key: "p_b", displayName: "B" },
      ],
    });
    expect(selectionAfterResolve(r, [])).toEqual(["p_a", "p_b"]);
  });

  it("@others: replaces selection with the complement set the resolver picked", () => {
    const r = resolved({
      mode: "others",
      targets: [{ provider: "mock", personaId: "p_b", key: "p_b", displayName: "B" }],
    });
    expect(selectionAfterResolve(r, ["p_a"])).toEqual(["p_b"]);
  });

  it("implicit: does NOT change the existing selection", () => {
    const r = resolved({
      mode: "implicit",
      targets: [{ provider: "mock", personaId: "p_a", key: "p_a", displayName: "A" }],
    });
    expect(selectionAfterResolve(r, ["p_a", "p_b"])).toEqual(["p_a", "p_b"]);
  });
});
