// Dynamic composer placeholder text — issue #61.
import { describe, it, expect } from "vitest";
import { buildPlaceholder } from "@/lib/ui/composerPlaceholder";
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
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

describe("buildPlaceholder", () => {
  it("lists selected persona names when selection is non-empty", () => {
    const personas = [persona("p_a", "claudio"), persona("p_b", "gepetto")];
    const text = buildPlaceholder(personas, ["p_a", "p_b"]);
    expect(text).toContain("claudio");
    expect(text).toContain("gepetto");
    expect(text).toContain("Enter to send");
  });

  it("prompts with available @names when nothing is selected", () => {
    const personas = [persona("p_a", "claudio"), persona("p_b", "gepetto")];
    const text = buildPlaceholder(personas, []);
    expect(text).toContain("@claudio");
    expect(text).toContain("@gepetto");
    expect(text).toContain("@all");
  });

  it("never mentions a persona that doesn't exist", () => {
    const text = buildPlaceholder([], []);
    expect(text).not.toContain("@alice");
    expect(text).toContain("Add a persona");
  });

  it("shows a single name without a comma-separated list", () => {
    const personas = [persona("p_a", "claudio")];
    const text = buildPlaceholder(personas, ["p_a"]);
    expect(text).toMatch(/Message to claudio\./);
  });
});
