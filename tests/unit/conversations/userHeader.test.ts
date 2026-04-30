// User-row header formatter — issue #18.
import { describe, it, expect } from "vitest";
import { formatUserHeader } from "@/lib/conversations/userHeader";
import type { Persona } from "@/lib/types";

function persona(id: string, name: string): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "claude",
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

describe("formatUserHeader", () => {
  const personas = [persona("p_alice", "Alice"), persona("p_bob", "Bob")];

  it("appends \u2192 @all when no addressedTo and no number", () => {
    expect(formatUserHeader(null, [], personas)).toBe("user \u2192 @all");
  });

  it("appends \u2192 @all when [N] is set but no addressedTo (#28)", () => {
    expect(formatUserHeader(3, [], personas)).toBe("[3] user \u2192 @all");
  });

  it("appends → @name list when addressedTo present", () => {
    const three = [
      persona("p_alice", "Alice"),
      persona("p_bob", "Bob"),
      persona("p_carol", "Carol"),
    ];
    expect(formatUserHeader(2, ["p_alice", "p_bob"], three)).toBe("[2] user \u2192 @Alice @Bob");
  });

  it("falls back to id when persona missing", () => {
    expect(formatUserHeader(1, ["p_ghost"], personas)).toBe("[1] user \u2192 @p_ghost");
  });

  it("works without [N] prefix when only addressedTo present", () => {
    expect(formatUserHeader(null, ["p_alice"], personas)).toBe("user \u2192 @Alice");
  });

  it("renders explicit @-list rather than @all when targets named (#28)", () => {
    expect(formatUserHeader(5, ["p_alice"], personas)).toBe("[5] user \u2192 @Alice");
  });

  it("renders @all shorthand when addressedTo covers every active persona (#130)", () => {
    // Both personas addressed \u2192 @all.
    expect(formatUserHeader(2, ["p_alice", "p_bob"], personas)).toBe("[2] user \u2192 @all");
  });

  it("@all shorthand is order-insensitive (#130)", () => {
    expect(formatUserHeader(2, ["p_bob", "p_alice"], personas)).toBe("[2] user \u2192 @all");
  });

  it("does NOT use @all shorthand with a single persona and one target", () => {
    const solo = [persona("p_alice", "Alice")];
    // When there's only one active persona, listing them explicitly would
    // technically be "all" \u2014 but "@all" reads oddly for a single name,
    // and the user typed the @-prefix, so keep the explicit form.
    // (This is the pre-existing behavior; just documenting it.)
    expect(formatUserHeader(1, ["p_alice"], solo)).toBe("[1] user \u2192 @Alice");
  });

  it("pinTarget overrides @all shorthand (#130)", () => {
    expect(formatUserHeader(7, ["p_alice", "p_bob"], personas, "p_alice")).toBe(
      "[7] user \u2192 @Alice",
    );
  });

  // #231 \u2014 flow-dispatched user messages get a "\u2192 conversation" marker
  // between the prefix and the addressedTo list, so a flow turn is
  // visually distinct from an explicit @a,@b multi-target send.
  describe("flow_dispatched marker (#231)", () => {
    it("inserts \u2192 conversation before the persona list when flowDispatched", () => {
      expect(
        formatUserHeader(3, ["p_alice", "p_bob"], personas, null, true),
      ).toBe("[3] user \u2192 conversation \u2192 @all");
    });

    it("works with a single-persona chain (single chain step)", () => {
      const three = [
        persona("p_alice", "Alice"),
        persona("p_bob", "Bob"),
        persona("p_carol", "Carol"),
      ];
      expect(formatUserHeader(2, ["p_alice"], three, null, true)).toBe(
        "[2] user \u2192 conversation \u2192 @Alice",
      );
    });

    it("does NOT add the marker when flowDispatched is false (today's behaviour)", () => {
      expect(
        formatUserHeader(3, ["p_alice", "p_bob"], personas, null, false),
      ).toBe("[3] user \u2192 @all");
    });

    it("flowDispatched omitted defaults to no marker", () => {
      expect(formatUserHeader(3, ["p_alice"], personas)).toBe(
        "[3] user \u2192 @Alice",
      );
    });

    it("pinTarget short-circuits the flow marker (pin path is unchanged)", () => {
      expect(
        formatUserHeader(7, ["p_alice", "p_bob"], personas, "p_alice", true),
      ).toBe("[7] user \u2192 @Alice");
    });
  });
});
