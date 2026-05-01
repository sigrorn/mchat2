// #78 — //visibility with no argument echoes current status.
import { describe, it, expect } from "vitest";
import { formatVisibilityStatus } from "@/lib/commands/visibilityStatus";
import type { Persona } from "@/lib/types";

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
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

describe("formatVisibilityStatus (#78)", () => {
  const personas = [persona("p_a", "alice"), persona("p_b", "bob"), persona("p_c", "carol")];

  it("empty matrix → full", () => {
    expect(formatVisibilityStatus({}, personas)).toBe("visibility: full.");
  });

  it("all personas with empty arrays → separated", () => {
    expect(formatVisibilityStatus({ p_a: [], p_b: [], p_c: [] }, personas)).toBe(
      "visibility: separated.",
    );
  });

  it("custom matrix → per-persona breakdown", () => {
    const result = formatVisibilityStatus({ p_a: ["p_b"], p_b: [], p_c: ["p_a", "p_b"] }, personas);
    expect(result).toContain("alice: bob");
    expect(result).toContain("bob: (none)");
    expect(result).toContain("carol: alice, bob");
  });

  it("partial matrix (some missing) → shows missing as full", () => {
    const result = formatVisibilityStatus({ p_a: [] }, personas);
    expect(result).toContain("alice: (none)");
    expect(result).toContain("bob: (full)");
    expect(result).toContain("carol: (full)");
  });

  it("no personas → full", () => {
    expect(formatVisibilityStatus({}, [])).toBe("visibility: full.");
  });
});
