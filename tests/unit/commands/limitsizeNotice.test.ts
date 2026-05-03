// #72 — //limitsize notice shows which persona(s) have the tightest limit.
import { describe, it, expect } from "vitest";
import { tightestBudgetNotice } from "@/lib/commands/limitsizeNotice";
import type { Persona } from "@/lib/types";

function persona(name: string, provider: Persona["provider"]): Persona {
  return {
    id: `p_${name}`,
    conversationId: "c_1",
    provider,
    name,
    nameSlug: name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

describe("tightestBudgetNotice (#72)", () => {
  // #257 Phase B: previously used apertus (16k) as the tight-context
  // benchmark. After removal, perplexity (~127k) and mistral (128k)
  // are the smallest non-infinite limits among native providers.
  // Mock has Infinity, so it's excluded from "tightest" results.
  it("shows single tightest persona", () => {
    const msg = tightestBudgetNotice([
      persona("claudio", "claude"),
      persona("ricky", "perplexity"),
    ]);
    expect(msg).toContain("[ricky]");
  });

  it("shows multiple personas at the same limit", () => {
    const msg = tightestBudgetNotice([
      persona("ricky", "perplexity"),
      persona("ricky2", "perplexity"),
    ]);
    expect(msg).toContain("[ricky, ricky2]");
  });

  it("returns null when no personas", () => {
    expect(tightestBudgetNotice([])).toBeNull();
  });

  it("returns null when all providers have infinite context", () => {
    expect(tightestBudgetNotice([persona("mocky", "mock")])).toBeNull();
  });
});
