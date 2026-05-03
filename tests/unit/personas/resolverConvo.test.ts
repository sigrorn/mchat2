// @convo target — slice 4 of #212 (#216).
//
// The resolver itself stays pure. @convo is parsed to mode="convo" with
// empty targets; a wrapper inflates targets from the flow's next
// personas-step.
import { describe, it, expect } from "vitest";
import { resolveTargets } from "@/lib/personas/resolver";
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
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

describe("resolveTargets @convo (#216)", () => {
  it("returns mode='convo' with empty targets and strips the prefix", () => {
    const r = resolveTargets({
      text: "@convo what's next?",
      personas: [persona("p_a", "Alice")],
      selection: [],
    });
    expect(r.mode).toBe("convo");
    expect(r.targets).toEqual([]);
    expect(r.strippedText).toBe("what's next?");
    expect(r.unknown).toEqual([]);
  });

  it("does not match 'convo' as a persona name", () => {
    // Even a persona named "convo" can't shadow the keyword — same
    // contract as @all and @others.
    const r = resolveTargets({
      text: "@convo hi",
      personas: [persona("p_a", "convo")],
      selection: [],
    });
    expect(r.mode).toBe("convo");
    expect(r.targets).toEqual([]);
  });
});
