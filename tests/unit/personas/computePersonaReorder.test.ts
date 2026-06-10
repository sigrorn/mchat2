// ------------------------------------------------------------------
// Component: computePersonaReorder test (#319)
// Responsibility: The drag-reorder math extracted from PersonaPanel.
//                 The load-bearing invariant (#273): each reordered
//                 persona's sortOrder must be bumped to its NEW array
//                 index, not just shuffled in the array — MessageList's
//                 cols-mode column ordering reads sortOrder directly, so
//                 a "just-shuffled-array" result would leave columns in
//                 the old order until a refresh.
// Collaborators: src/lib/personas/reorderComputation.
// ------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { computePersonaReorder } from "@/lib/personas/reorderComputation";
import type { Persona } from "@/lib/types";

function p(id: string, sortOrder: number): Persona {
  return {
    id,
    conversationId: "c1",
    provider: "mock",
    name: id,
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

describe("computePersonaReorder (#319)", () => {
  const list = [p("a", 0), p("b", 1), p("c", 2)];

  it("moves an item and renumbers sortOrder to the new index (#273)", () => {
    // Drag 'a' onto 'c' → order becomes b, c, a.
    const r = computePersonaReorder(list, "a", "c");
    expect(r).not.toBeNull();
    expect(r!.nextOrder).toEqual(["b", "c", "a"]);
    expect(r!.reordered.map((x) => [x.id, x.sortOrder])).toEqual([
      ["b", 0],
      ["c", 1],
      ["a", 2],
    ]);
  });

  it("moves upward and renumbers", () => {
    const r = computePersonaReorder(list, "c", "a");
    expect(r!.nextOrder).toEqual(["c", "a", "b"]);
    expect(r!.reordered.map((x) => x.sortOrder)).toEqual([0, 1, 2]);
  });

  it("returns null when active === over (no-op drag)", () => {
    expect(computePersonaReorder(list, "b", "b")).toBeNull();
  });

  it("returns null when an id is not in the list", () => {
    expect(computePersonaReorder(list, "ghost", "a")).toBeNull();
    expect(computePersonaReorder(list, "a", "ghost")).toBeNull();
  });
});
