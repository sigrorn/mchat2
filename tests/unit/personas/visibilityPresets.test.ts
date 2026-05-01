// #173 — visibility-preset shortcuts in the persona form. Three
// roles bulk-set the form's visDefs + seenByEdits maps; the user
// can still tweak individual cells afterwards. Pure-data helper so
// the React layer stays a thin caller.
import { describe, it, expect } from "vitest";
import { applyVisibilityPreset } from "@/lib/personas/visibilityPresets";
import type { Persona } from "@/lib/types";

function persona(over: Partial<Persona> & { id: string; name: string }): Persona {
  return {
    id: over.id,
    conversationId: over.conversationId ?? "c_1",
    provider: over.provider ?? "claude",
    name: over.name,
    nameSlug: over.nameSlug ?? over.name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {},
    openaiCompatPreset: null, roleLens: {},
  };
}

const SIBLINGS: readonly Persona[] = [
  persona({ id: "p_a", name: "Alice", nameSlug: "alice" }),
  persona({ id: "p_b", name: "Bob", nameSlug: "bob" }),
  persona({ id: "p_c", name: "Carol", nameSlug: "carol" }),
];

describe("applyVisibilityPreset", () => {
  it("Speaker: sees no one, seen by everyone", () => {
    const r = applyVisibilityPreset("speaker", SIBLINGS);
    expect(r.visDefs).toEqual({ alice: "n", bob: "n", carol: "n" });
    expect(r.seenByEdits).toEqual({ alice: "y", bob: "y", carol: "y" });
  });

  it("Participant: sees everyone, seen by everyone", () => {
    const r = applyVisibilityPreset("participant", SIBLINGS);
    expect(r.visDefs).toEqual({ alice: "y", bob: "y", carol: "y" });
    expect(r.seenByEdits).toEqual({ alice: "y", bob: "y", carol: "y" });
  });

  it("Observer: sees everyone, seen by no one", () => {
    const r = applyVisibilityPreset("observer", SIBLINGS);
    expect(r.visDefs).toEqual({ alice: "y", bob: "y", carol: "y" });
    expect(r.seenByEdits).toEqual({ alice: "n", bob: "n", carol: "n" });
  });

  it("returns empty maps when there are no siblings", () => {
    const r = applyVisibilityPreset("participant", []);
    expect(r.visDefs).toEqual({});
    expect(r.seenByEdits).toEqual({});
  });

  it("keys the maps by nameSlug, not name (case-insensitive matching downstream)", () => {
    const r = applyVisibilityPreset(
      "participant",
      [persona({ id: "p_x", name: "Mixed-Case", nameSlug: "mixed-case" })],
    );
    expect(Object.keys(r.visDefs)).toEqual(["mixed-case"]);
    expect(Object.keys(r.seenByEdits)).toEqual(["mixed-case"]);
  });

  it("the three roles cover the corners of the (sees, seen-by) matrix", () => {
    // Useful sanity check: Participant is full-duplex; Speaker and
    // Observer are mirror opposites; full-isolation isn't a preset
    // (rare; user can hand-toggle if needed).
    const speaker = applyVisibilityPreset("speaker", SIBLINGS);
    const observer = applyVisibilityPreset("observer", SIBLINGS);
    expect(speaker.visDefs).toEqual(observer.seenByEdits);
    expect(speaker.seenByEdits).toEqual(observer.visDefs);
  });
});
