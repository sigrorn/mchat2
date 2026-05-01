// Tests for computePersonaCosts and the cost formatter — issue #2.
import { describe, it, expect } from "vitest";
import { computePersonaCosts, formatPersonaCost } from "@/lib/pricing/personaCosts";
import { makeMessage } from "@/lib/persistence/messages";
import type { Persona } from "@/lib/types";

function persona(id: string, provider: Persona["provider"] = "claude"): Persona {
  return {
    id,
    conversationId: "c_1",
    provider,
    name: id,
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

describe("computePersonaCosts", () => {
  it("sums assistant-message cost per persona", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a",
        provider: "claude",
        model: "claude-sonnet-4-6",
        personaId: "p_alice",
        inputTokens: 1_000_000,
        outputTokens: 0,
        usageEstimated: false,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "b",
        provider: "claude",
        model: "claude-sonnet-4-6",
        personaId: "p_alice",
        inputTokens: 0,
        outputTokens: 1_000_000,
        usageEstimated: false,
      }),
    ];
    const costs = computePersonaCosts(messages, [persona("p_alice")]);
    expect(costs["p_alice"]?.usd).toBeCloseTo(3 + 15, 5);
    expect(costs["p_alice"]?.approximate).toBe(false);
  });

  it("ignores user rows and other personas' rows", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi" }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "x",
        provider: "claude",
        model: "claude-sonnet-4-6",
        personaId: "p_bob",
        inputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ];
    const costs = computePersonaCosts(messages, [persona("p_alice")]);
    expect(costs["p_alice"]?.usd ?? 0).toBe(0);
  });

  it("marks approximate=true if any contributing row is approximate", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a",
        provider: "claude",
        model: "claude-sonnet-4-6",
        personaId: "p_alice",
        inputTokens: 100,
        outputTokens: 100,
        usageEstimated: false,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "b",
        provider: "claude",
        model: "claude-sonnet-4-6",
        personaId: "p_alice",
        inputTokens: 100,
        outputTokens: 100,
        usageEstimated: true,
      }),
    ];
    const costs = computePersonaCosts(messages, [persona("p_alice")]);
    expect(costs["p_alice"]?.approximate).toBe(true);
  });
});

describe("formatPersonaCost", () => {
  it("returns an em-dash for zero cost", () => {
    expect(formatPersonaCost({ usd: 0, approximate: false })).toBe("—");
  });
  it("prefixes approximate costs with ~", () => {
    expect(formatPersonaCost({ usd: 0.001234, approximate: true })).toMatch(/^~\$/);
  });
  it("exact costs have no prefix", () => {
    expect(formatPersonaCost({ usd: 1.23, approximate: false })).toBe("$1.2300");
  });
});
