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
    runsAfter: null,
    deletedAt: null,
    apertusProductId: null,
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
});
