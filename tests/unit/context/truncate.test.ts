// Automatic context truncation — issue #55.
import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  truncateToFit,
} from "@/lib/context/truncate";
import type { ChatMessage } from "@/lib/providers/adapter";

function msg(role: "user" | "assistant", content: string): ChatMessage {
  return { role, content };
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("a")).toBe(1); // ceil
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("truncateToFit", () => {
  it("no-op when everything fits", () => {
    const messages: ChatMessage[] = [msg("user", "hi"), msg("assistant", "hello")];
    const r = truncateToFit(null, messages, 1000);
    expect(r.messages).toEqual(messages);
    expect(r.dropped).toBe(0);
  });

  it("drops oldest non-pinned messages first", () => {
    // 5 messages, each ~100 chars → ~25 tokens each → ~125 total
    const messages: ChatMessage[] = Array.from({ length: 5 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", "x".repeat(100)),
    );
    // Limit to 75 tokens → should keep ~3 messages
    const r = truncateToFit(null, messages, 75);
    expect(r.dropped).toBeGreaterThan(0);
    expect(r.messages.length).toBeLessThan(5);
    // Last message always preserved
    expect(r.messages[r.messages.length - 1]).toEqual(messages[4]);
  });

  it("always keeps the last message (the user prompt)", () => {
    const messages: ChatMessage[] = [msg("user", "x".repeat(10000))];
    const r = truncateToFit(null, messages, 10);
    expect(r.messages).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("accounts for the system prompt in the budget", () => {
    const systemPrompt = "x".repeat(400); // ~100 tokens
    const messages: ChatMessage[] = [
      msg("user", "x".repeat(100)),
      msg("assistant", "x".repeat(100)),
      msg("user", "x".repeat(100)),
    ];
    // 100 (system) + 75 (messages) = 175 total → limit 120 should drop
    const r = truncateToFit(systemPrompt, messages, 120);
    expect(r.dropped).toBeGreaterThan(0);
  });

  it("preserves pinned messages (passed via pinnedIndices)", () => {
    const messages: ChatMessage[] = [
      msg("user", "x".repeat(400)),   // idx 0, pinned
      msg("assistant", "x".repeat(400)), // idx 1
      msg("user", "x".repeat(400)),   // idx 2
      msg("assistant", "x".repeat(400)), // idx 3
      msg("user", "short"),           // idx 4, last
    ];
    const r = truncateToFit(null, messages, 120, new Set([0]));
    // idx 0 must survive (pinned), idx 4 must survive (last)
    expect(r.messages[0]).toEqual(messages[0]);
    expect(r.messages[r.messages.length - 1]).toEqual(messages[4]);
    expect(r.dropped).toBeGreaterThan(0);
  });
});
