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
    visibilityDefaults: {},
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
    expect(formatUserHeader(2, ["p_alice", "p_bob"], personas)).toBe("[2] user \u2192 @Alice @Bob");
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
});
