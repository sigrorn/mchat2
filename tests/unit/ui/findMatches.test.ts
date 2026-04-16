// Find-in-chat match finder — issue #53.
import { describe, it, expect } from "vitest";
import { findMatches } from "@/lib/ui/findMatches";
import { makeMessage } from "@/lib/persistence/messages";

function m(id: string, content: string, index: number) {
  return makeMessage({ conversationId: "c_1", id, content, index });
}

describe("findMatches", () => {
  it("returns empty list for empty query", () => {
    expect(findMatches([m("a", "hello", 0)], "", false)).toEqual([]);
  });

  it("finds a single match (case-insensitive by default)", () => {
    const messages = [m("a", "Hello World", 0)];
    const matches = findMatches(messages, "hello", false);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({ messageId: "a", start: 0, end: 5 });
  });

  it("honors case-sensitive mode", () => {
    const messages = [m("a", "Hello World", 0)];
    expect(findMatches(messages, "hello", true)).toEqual([]);
    const m2 = findMatches(messages, "Hello", true);
    expect(m2).toHaveLength(1);
  });

  it("finds multiple matches in the same message", () => {
    const messages = [m("a", "abab", 0)];
    const matches = findMatches(messages, "a", false);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ messageId: "a", start: 0, end: 1 });
    expect(matches[1]).toEqual({ messageId: "a", start: 2, end: 3 });
  });

  it("iterates in history order across messages", () => {
    const messages = [m("a", "first", 0), m("b", "first again", 1)];
    const matches = findMatches(messages, "first", false);
    expect(matches.map((x) => x.messageId)).toEqual(["a", "b"]);
  });

  it("returns empty when query matches nothing", () => {
    expect(findMatches([m("a", "hello", 0)], "xyz", false)).toEqual([]);
  });

  it("ignores messages with empty content", () => {
    const messages = [m("a", "", 0), m("b", "match", 1)];
    const matches = findMatches(messages, "match", false);
    expect(matches.map((x) => x.messageId)).toEqual(["b"]);
  });
});
