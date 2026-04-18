// #94 — Per-persona visibility defaults and matrix building.
import { describe, it, expect } from "vitest";
import { buildMatrixFromDefaults } from "@/lib/personas/service";
import type { Persona } from "@/lib/types";

function persona(over: Partial<Persona> & { id: string; name: string }): Persona {
  return {
    id: over.id,
    conversationId: over.conversationId ?? "c_1",
    provider: over.provider ?? "mock",
    name: over.name,
    nameSlug: over.nameSlug ?? over.name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: over.visibilityDefaults ?? {},
  };
}

describe("buildMatrixFromDefaults", () => {
  it("returns empty matrix when no persona has defaults", () => {
    const ps = [persona({ id: "p_a", name: "Alice" }), persona({ id: "p_b", name: "Bob" })];
    expect(buildMatrixFromDefaults(ps)).toEqual({});
  });

  it("returns empty matrix when defaults are all 'y'", () => {
    const ps = [
      persona({ id: "p_a", name: "Alice", visibilityDefaults: { bob: "y" } }),
      persona({ id: "p_b", name: "Bob", visibilityDefaults: { alice: "y" } }),
    ];
    expect(buildMatrixFromDefaults(ps)).toEqual({});
  });

  it("language coach: sees all, seen by none", () => {
    // Alice and Bob should have Coach hidden (not in their row).
    // Cross-editing would have set alice.sees[coach]='n' and bob.sees[coach]='n',
    // but buildMatrixFromDefaults just reads what's stored.
    // To test the full scenario, Alice and Bob need coach='n' in their defaults.
    const psWithCross = [
      persona({
        id: "p_a",
        name: "Alice",
        visibilityDefaults: { coach: "n" },
      }),
      persona({
        id: "p_b",
        name: "Bob",
        visibilityDefaults: { coach: "n" },
      }),
      persona({
        id: "p_c",
        name: "Coach",
        visibilityDefaults: { alice: "y", bob: "y" },
      }),
    ];
    const matrix = buildMatrixFromDefaults(psWithCross);
    // Alice sees Bob but not Coach
    expect(matrix["p_a"]).toEqual(["p_b"]);
    // Bob sees Alice but not Coach
    expect(matrix["p_b"]).toEqual(["p_a"]);
    // Coach has no 'n' entries, so no matrix row (full visibility)
    expect(matrix["p_c"]).toBeUndefined();
  });

  it("asymmetric: A sees B, B does not see A", () => {
    const ps = [
      persona({
        id: "p_a",
        name: "Alice",
        visibilityDefaults: { bob: "y" },
      }),
      persona({
        id: "p_b",
        name: "Bob",
        visibilityDefaults: { alice: "n" },
      }),
    ];
    const matrix = buildMatrixFromDefaults(ps);
    // Alice has no 'n' → no matrix row
    expect(matrix["p_a"]).toBeUndefined();
    // Bob has alice='n' → matrix row excluding Alice
    expect(matrix["p_b"]).toEqual([]);
  });

  it("ignores unknown slugs in defaults", () => {
    const ps = [
      persona({
        id: "p_a",
        name: "Alice",
        visibilityDefaults: { ghost: "n" },
      }),
    ];
    const matrix = buildMatrixFromDefaults(ps);
    // 'ghost' doesn't match any persona, so Alice's row is empty
    // (but she has a 'n' entry, so she gets a matrix row)
    expect(matrix["p_a"]).toEqual([]);
  });
});
