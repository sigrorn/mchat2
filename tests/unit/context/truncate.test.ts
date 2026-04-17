// Automatic context truncation — issue #55.
import { describe, it, expect } from "vitest";
import { estimateTokens, truncateToFit, type SourceInfo } from "@/lib/context/truncate";
import type { ChatMessage } from "@/lib/providers/adapter";

function msg(role: "user" | "assistant", content: string): ChatMessage {
  return { role, content };
}

function si(pinned: boolean, userNumber: number | null): SourceInfo {
  return { pinned, userNumber };
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("a")).toBe(1);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("truncateToFit (turn-aware)", () => {
  it("no-op when everything fits", () => {
    const messages: ChatMessage[] = [msg("user", "hi"), msg("assistant", "hello")];
    const r = truncateToFit(null, messages, 1000);
    expect(r.messages).toEqual(messages);
    expect(r.dropped).toBe(0);
  });

  it("drops whole turns (user + its assistant replies) oldest-first", () => {
    const messages: ChatMessage[] = [
      msg("user", "x".repeat(100)),
      msg("assistant", "x".repeat(100)),
      msg("user", "y".repeat(100)),
      msg("assistant", "y".repeat(100)),
      msg("user", "last"),
    ];
    const info: SourceInfo[] = [
      si(false, 1),
      si(false, null),
      si(false, 2),
      si(false, null),
      si(false, 3),
    ];
    const r = truncateToFit(null, messages, 60, info);
    expect(r.dropped).toBe(2);
    expect(r.messages[0]).toEqual(messages[2]);
    expect(r.messages[r.messages.length - 1]).toEqual(messages[4]);
  });

  it("always keeps the last turn", () => {
    const messages: ChatMessage[] = [msg("user", "x".repeat(10000))];
    const r = truncateToFit(null, messages, 10);
    expect(r.messages).toHaveLength(1);
    expect(r.dropped).toBe(0);
  });

  it("accounts for the system prompt in the budget", () => {
    const systemPrompt = "x".repeat(400);
    const messages: ChatMessage[] = [
      msg("user", "x".repeat(100)),
      msg("assistant", "x".repeat(100)),
      msg("user", "x".repeat(100)),
    ];
    const r = truncateToFit(systemPrompt, messages, 120);
    expect(r.dropped).toBeGreaterThan(0);
  });

  it("preserves pinned turns", () => {
    const messages: ChatMessage[] = [
      msg("user", "x".repeat(400)),
      msg("user", "x".repeat(400)),
      msg("assistant", "x".repeat(400)),
      msg("user", "x".repeat(400)),
      msg("assistant", "x".repeat(400)),
      msg("user", "short"),
    ];
    const info: SourceInfo[] = [
      si(true, 1),
      si(false, 2),
      si(false, null),
      si(false, 3),
      si(false, null),
      si(false, 4),
    ];
    const r = truncateToFit(null, messages, 150, info);
    expect(r.messages[0]).toEqual(messages[0]);
    expect(r.messages[r.messages.length - 1]).toEqual(messages[5]);
    expect(r.dropped).toBeGreaterThan(0);
  });

  it("reports firstSurvivingUserNumber for the notice", () => {
    // Turn 1: user(100)+asst(100)=~50 tok; Turn 2: user(100)+asst(100)=~50 tok;
    // Turn 3: user("last")=~2 tok. Total ~102. Budget = 80*0.9 = 72.
    // Drop turn 1 (50) → 52 ≤ 72. Turn 2 (userNumber=2) is first survivor.
    const messages: ChatMessage[] = [
      msg("user", "x".repeat(100)),
      msg("assistant", "x".repeat(100)),
      msg("user", "y".repeat(100)),
      msg("assistant", "y".repeat(100)),
      msg("user", "last"),
    ];
    const info: SourceInfo[] = [
      si(false, 1),
      si(false, null),
      si(false, 2),
      si(false, null),
      si(false, 3),
    ];
    const r = truncateToFit(null, messages, 80, info);
    expect(r.firstSurvivingUserNumber).toBe(2);
  });
});
