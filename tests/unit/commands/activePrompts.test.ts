// ------------------------------------------------------------------
// Component: formatActivePrompts tests (#264)
// Responsibility: Pin the //activeprompts notice format. Mirrors the
//                 four-layer composition logic in builder.ts:113 so
//                 the user sees exactly what each persona will be
//                 sent at next dispatch — global, conversation,
//                 persona override (with explicit-empty sentinel),
//                 and per-step instruction when a flow is attached.
// ------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { formatActivePrompts } from "@/lib/commands/activePrompts";
import type { Persona } from "@/lib/types";

function makePersona(over: Partial<Persona>): Persona {
  return {
    id: "p_" + (over.name ?? "x"),
    conversationId: "c_test",
    provider: "claude",
    name: "p",
    nameSlug: "p",
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
    ...over,
  };
}

describe("formatActivePrompts", () => {
  it("reports an empty conversation with no personas", () => {
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: null,
      personas: [],
    });
    expect(out).toMatch(/no personas/i);
  });

  it("renders one persona inheriting the conversation prompt", () => {
    const persona = makePersona({ name: "alice", systemPromptOverride: null });
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "be helpful",
      personas: [persona],
    });
    expect(out).toContain("alice");
    expect(out).toContain("be helpful");
    // Source annotation: "from conversation" (or similar) so the user
    // knows the persona didn't supply its own override.
    expect(out.toLowerCase()).toMatch(/from conversation/);
    // Identity line ALWAYS renders for a named persona.
    expect(out).toContain("You are alice");
  });

  it("renders persona override with the 'from persona override' source", () => {
    const persona = makePersona({
      name: "bob",
      systemPromptOverride: "you specialize in cooking",
    });
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "general purpose",
      personas: [persona],
    });
    expect(out).toContain("you specialize in cooking");
    expect(out.toLowerCase()).toMatch(/from persona override/);
    // The conversation prompt is shadowed for this persona — the
    // formatter doesn't sneak it into bob's block.
    const bobBlockStart = out.indexOf("bob");
    const bobBlockEnd = out.length;
    expect(out.slice(bobBlockStart, bobBlockEnd)).not.toContain("general purpose");
  });

  it("treats override=\"\" as explicit empty — local layer skipped", () => {
    // builder.ts uses ?? for fallback, so "" stops the fallback and
    // then the !!s filter drops it from the join. Net effect: persona
    // sees NO local prompt despite the conversation having one.
    const persona = makePersona({ name: "carol", systemPromptOverride: "" });
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "should not reach carol",
      personas: [persona],
    });
    expect(out).toContain("carol");
    expect(out.toLowerCase()).toMatch(/explicit empty|skipped/);
    // The conversation prompt does NOT leak into carol's local layer.
    const carolBlockStart = out.indexOf("carol");
    expect(out.slice(carolBlockStart)).not.toContain("should not reach carol");
  });

  it("annotates the conversation prompt as shadowed when overrides exist", () => {
    const personas = [
      makePersona({ name: "a", systemPromptOverride: "A override" }),
      makePersona({ name: "b", systemPromptOverride: null }),
      makePersona({ name: "c", systemPromptOverride: "C override" }),
    ];
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "convo prompt",
      personas,
    });
    expect(out).toContain("convo prompt");
    // 2 of 3 personas have overrides. Annotation surfaces that count
    // so the user knows editing the conversation prompt only reaches
    // one persona.
    expect(out.toLowerCase()).toMatch(/shadowed.*2.*3|2 of 3/);
  });

  it("annotates 'shadowed by all' when every persona has an override", () => {
    const personas = [
      makePersona({ name: "a", systemPromptOverride: "A" }),
      makePersona({ name: "b", systemPromptOverride: "B" }),
    ];
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "dead code for this convo",
      personas,
    });
    // The conversation prompt reaches no persona — call it out
    // distinctly so the user knows it's effectively dead code here.
    expect(out.toLowerCase()).toMatch(/shadowed.*all|dead code|never reaches/);
  });

  it("renders the global prompt section when set", () => {
    const persona = makePersona({ name: "alice" });
    const out = formatActivePrompts({
      globalPrompt: "always be polite",
      conversationPrompt: null,
      personas: [persona],
    });
    expect(out).toContain("always be polite");
    expect(out.toLowerCase()).toMatch(/global/);
  });

  it("includes a per-persona step note when one is provided", () => {
    const persona = makePersona({ name: "alice" });
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "convo",
      personas: [persona],
      stepNotes: { [persona.id]: "summarise the previous reply" },
    });
    expect(out).toContain("summarise the previous reply");
    // The step note appears under alice's block, not as a top-level
    // section (it's per-persona, applies only when in a flow step).
    expect(out.toLowerCase()).toMatch(/step/);
  });

  it("omits step note when none is provided for the persona", () => {
    const persona = makePersona({ name: "alice" });
    const out = formatActivePrompts({
      globalPrompt: null,
      conversationPrompt: "convo",
      personas: [persona],
      stepNotes: {},
    });
    // No leftover "Step note:" placeholder when there's nothing to show.
    expect(out).not.toMatch(/step note:\s*$/im);
  });
});
