// Global system prompt prepending — issue #23.
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context/builder";
import type { Conversation, Persona, PersonaTarget } from "@/lib/types";

const conv: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
};

const persona: Persona = {
  id: "p_a",
  conversationId: "c_1",
  provider: "claude",
  name: "Alice",
  nameSlug: "alice",
  systemPromptOverride: null,
  modelOverride: null,
  colorOverride: null,
  createdAtMessageIndex: 0,
  sortOrder: 0,
  runsAfter: null,
  deletedAt: null,
  apertusProductId: null,
};

const target: PersonaTarget = { provider: "claude", personaId: "p_a", key: "p_a", displayName: "Alice" };

describe("buildContext globalSystemPrompt", () => {
  it("uses the global prompt when no other system prompt is set", () => {
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe("be harsh");
  });

  it("prepends the global prompt above the persona override", () => {
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [{ ...persona, systemPromptOverride: "you are Alice" }],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe("be harsh\n\nyou are Alice");
  });

  it("prepends above the conversation prompt when no persona override", () => {
    const r = buildContext({
      conversation: { ...conv, systemPrompt: "stay on topic" },
      target,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe("be harsh\n\nstay on topic");
  });

  it("yields null when neither tier has anything", () => {
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
    });
    expect(r.systemPrompt).toBeNull();
  });

  it("ignores an empty / whitespace-only global prompt", () => {
    const r = buildContext({
      conversation: { ...conv, systemPrompt: "stay on topic" },
      target,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "   ",
    });
    expect(r.systemPrompt).toBe("stay on topic");
  });
});
