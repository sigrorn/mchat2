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
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
  };
}

describe("tightestBudgetNotice (#72)", () => {
  it("shows single tightest persona", () => {
    const msg = tightestBudgetNotice([persona("claudio", "claude"), persona("albert", "apertus")]);
    expect(msg).toContain("16k");
    expect(msg).toContain("[albert]");
  });

  it("shows multiple personas at the same limit", () => {
    const msg = tightestBudgetNotice([persona("albert", "apertus"), persona("albert2", "apertus")]);
    expect(msg).toContain("[albert, albert2]");
  });

  it("returns null when no personas", () => {
    expect(tightestBudgetNotice([])).toBeNull();
  });

  it("returns null when all providers have infinite context", () => {
    expect(tightestBudgetNotice([persona("mocky", "mock")])).toBeNull();
  });
});
