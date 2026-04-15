// Pin-listing notice formatter — issue #11.
import { describe, it, expect } from "vitest";
import { formatPinsNotice } from "@/lib/conversations/pinFormatter";
import { makeMessage } from "@/lib/persistence/messages";
import type { Message, Persona } from "@/lib/types";

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

describe("formatPinsNotice", () => {
  const personas = [persona("p_alice", "Alice"), persona("p_bob", "Bob")];

  it("empty state when there are no pins", () => {
    expect(formatPinsNotice([], personas, null)).toMatch(/no pinned messages/i);
  });

  it("lists pinned messages with [N] prefix and target labels", () => {
    const messages: Message[] = [
      makeMessage({ conversationId: "c_1", role: "user", content: "u1", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "always reply in Italian",
        index: 1,
        pinned: true,
        addressedTo: ["p_alice"],
      }),
      makeMessage({ conversationId: "c_1", role: "user", content: "u2", index: 2 }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "be brief",
        index: 3,
        pinned: true,
        addressedTo: ["p_alice", "p_bob"],
      }),
    ];
    const out = formatPinsNotice(messages, personas, null);
    expect(out).toMatch(/\[2\]/);
    expect(out).toMatch(/\[4\]/);
    expect(out).toContain("Alice");
    expect(out).toContain("Bob");
    expect(out).toContain("always reply in Italian");
    expect(out).toContain("be brief");
  });

  it("filters by persona when name supplied", () => {
    const messages: Message[] = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "for alice",
        index: 0,
        pinned: true,
        addressedTo: ["p_alice"],
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "for bob",
        index: 1,
        pinned: true,
        addressedTo: ["p_bob"],
      }),
    ];
    const out = formatPinsNotice(messages, personas, "alice");
    expect(out).toContain("for alice");
    expect(out).not.toContain("for bob");
  });

  it("returns null for an unknown persona name (caller emits error)", () => {
    expect(formatPinsNotice([], personas, "nobody")).toBeNull();
  });

  it("renders one pin per line, no colon between target and content (#19)", () => {
    const messages: Message[] = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "for alice",
        index: 0,
        pinned: true,
        addressedTo: ["p_alice"],
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "for everyone",
        index: 1,
        pinned: true,
        addressedTo: [],
      }),
    ];
    const out = formatPinsNotice(messages, personas, null);
    expect(out).toBe(
      ["Pinned messages:", "[1] @Alice for alice", "[2] @all for everyone"].join("\n"),
    );
  });

  it("identity pins (single pinTarget, empty addressedTo) included", () => {
    const messages: Message[] = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "use Alice as your name",
        index: 0,
        pinned: true,
        pinTarget: "p_alice",
      }),
    ];
    const out = formatPinsNotice(messages, personas, null);
    expect(out).toContain("Alice");
    expect(out).toContain("use Alice as your name");
  });
});
