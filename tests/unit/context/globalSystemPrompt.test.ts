// System prompt layering: global + persona-identity + local — #23 + #39.
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
  visibilityMatrix: {},
  limitSizeTokens: null,
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

const personaTarget: PersonaTarget = {
  provider: "claude",
  personaId: "p_a",
  key: "p_a",
  displayName: "Alice",
};

const bareTarget: PersonaTarget = {
  provider: "claude",
  personaId: null,
  key: "claude",
  displayName: "Claude",
};

const IDENTITY =
  "You are Alice. Only respond as yourself — do not include or generate responses for other personas.";

describe("buildContext system prompt layering", () => {
  it("identity-line only: no global, no local, persona target (#39)", () => {
    const r = buildContext({
      conversation: conv,
      target: personaTarget,
      messages: [],
      personas: [persona],
    });
    expect(r.systemPrompt).toBe(IDENTITY);
  });

  it("identity + global, no local (#39, ordered to match old mchat)", () => {
    const r = buildContext({
      conversation: conv,
      target: personaTarget,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe(`${IDENTITY}\n\nbe harsh`);
  });

  it("identity + persona override (#39)", () => {
    const r = buildContext({
      conversation: conv,
      target: personaTarget,
      messages: [],
      personas: [{ ...persona, systemPromptOverride: "you only speak Italian" }],
    });
    expect(r.systemPrompt).toBe(`${IDENTITY}\n\nyou only speak Italian`);
  });

  it("identity + global + persona override, in that order (#39)", () => {
    const r = buildContext({
      conversation: conv,
      target: personaTarget,
      messages: [],
      personas: [{ ...persona, systemPromptOverride: "you only speak Italian" }],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe(`${IDENTITY}\n\nbe harsh\n\nyou only speak Italian`);
  });

  it("identity + global + conversation prompt (no persona override) (#39)", () => {
    const r = buildContext({
      conversation: { ...conv, systemPrompt: "stay on topic" },
      target: personaTarget,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe(`${IDENTITY}\n\nbe harsh\n\nstay on topic`);
  });

  it("bare-provider target gets NO identity line (#39)", () => {
    const r = buildContext({
      conversation: { ...conv, systemPrompt: "stay on topic" },
      target: bareTarget,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "be harsh",
    });
    expect(r.systemPrompt).toBe("be harsh\n\nstay on topic");
  });

  it("bare-provider target with no prompts yields null", () => {
    const r = buildContext({
      conversation: conv,
      target: bareTarget,
      messages: [],
      personas: [persona],
    });
    expect(r.systemPrompt).toBeNull();
  });

  it("ignores an empty / whitespace-only global prompt", () => {
    const r = buildContext({
      conversation: { ...conv, systemPrompt: "stay on topic" },
      target: personaTarget,
      messages: [],
      personas: [persona],
      globalSystemPrompt: "   ",
    });
    // Only identity + local survive; whitespace-only global skipped.
    expect(r.systemPrompt).toBe(`${IDENTITY}\n\nstay on topic`);
  });
});
