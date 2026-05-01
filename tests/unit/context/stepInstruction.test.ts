// buildContext appends per-step hidden instruction to system prompt (#230).
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
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
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
  deletedAt: null,
  apertusProductId: null,
  visibilityDefaults: {},
  openaiCompatPreset: null,
  roleLens: {},
};

const target: PersonaTarget = {
  provider: "claude",
  personaId: "p_a",
  key: "p_a",
  displayName: "Alice",
};

const IDENTITY =
  "You are Alice. Only respond as yourself — do not include or generate responses for other personas.";

describe("buildContext stepInstruction (#230)", () => {
  it("appends 'Step note: <instruction>' below the existing system block when set", () => {
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
      stepInstruction: "Focus on the economic angle for this round.",
    });
    expect(r.systemPrompt).toBe(
      `${IDENTITY}\n\nStep note: Focus on the economic angle for this round.`,
    );
  });

  it("preserves the global + persona override layering (step note last)", () => {
    const personaWithOverride: Persona = {
      ...persona,
      systemPromptOverride: "Always be harsh.",
    };
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [personaWithOverride],
      globalSystemPrompt: "Be concise.",
      stepInstruction: "This round, summarise the prior turn first.",
    });
    expect(r.systemPrompt).toBe(
      `${IDENTITY}\n\nBe concise.\n\nAlways be harsh.\n\nStep note: This round, summarise the prior turn first.`,
    );
  });

  it("omitted stepInstruction → unchanged system prompt (today's behaviour)", () => {
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
    });
    expect(r.systemPrompt).toBe(IDENTITY);
  });

  it("empty / whitespace stepInstruction → no Step note line", () => {
    const r1 = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
      stepInstruction: "",
    });
    const r2 = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
      stepInstruction: "   ",
    });
    expect(r1.systemPrompt).toBe(IDENTITY);
    expect(r2.systemPrompt).toBe(IDENTITY);
  });

  it("null stepInstruction → no Step note line", () => {
    const r = buildContext({
      conversation: conv,
      target,
      messages: [],
      personas: [persona],
      stepInstruction: null,
    });
    expect(r.systemPrompt).toBe(IDENTITY);
  });
});
