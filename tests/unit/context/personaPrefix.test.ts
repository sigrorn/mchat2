// #87 — Prefix assistant messages with persona name in context.
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, Persona, PersonaTarget } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "joined",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
};

function persona(id: string, name: string): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "mock",
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
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

function target(id: string): PersonaTarget {
  return { provider: "mock", personaId: id, key: id, displayName: id };
}

describe("assistant persona prefix in context (#87)", () => {
  it("prefixes other personas' messages with their name", () => {
    const personas = [persona("p_a", "alice"), persona("p_b", "bob")];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "hello from bob",
        provider: "mock",
        personaId: "p_b",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a"),
      messages,
      personas,
    });
    const bobMsg = r.messages.find((m) => m.content.includes("hello from bob"));
    expect(bobMsg?.content).toMatch(/^bob:/);
  });

  it("does NOT prefix the target persona's own messages", () => {
    const personas = [persona("p_a", "alice")];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "my own reply",
        provider: "mock",
        personaId: "p_a",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a"),
      messages,
      personas,
    });
    const ownMsg = r.messages.find((m) => m.content.includes("my own reply"));
    expect(ownMsg?.content).toBe("my own reply");
  });
});
