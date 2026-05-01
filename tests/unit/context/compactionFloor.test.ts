// #102 — Compaction floor excludes messages below it from context.
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
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
  compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
};

function persona(): Persona {
  return {
    id: "p_a",
    conversationId: "c_1",
    provider: "mock",
    name: "Alice",
    nameSlug: "alice",
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

function target(): PersonaTarget {
  return { provider: "mock", personaId: "p_a", key: "p_a", displayName: "Alice" };
}

describe("compactionFloorIndex", () => {
  it("null floor → all messages included", () => {
    const msgs = [
      makeMessage({ conversationId: "c_1", role: "user", content: "m1", index: 0 }),
      makeMessage({ conversationId: "c_1", role: "assistant", content: "r1", index: 1, personaId: "p_a" }),
    ];
    const r = buildContext({ conversation: CONV, target: target(), messages: msgs, personas: [persona()] });
    expect(r.messages).toHaveLength(2);
  });

  it("floor at index 5 → messages 0-4 excluded", () => {
    const msgs = [
      makeMessage({ conversationId: "c_1", role: "user", content: "old", index: 2 }),
      makeMessage({ conversationId: "c_1", role: "assistant", content: "old-r", index: 3, personaId: "p_a" }),
      makeMessage({ conversationId: "c_1", role: "user", content: "new", index: 5 }),
      makeMessage({ conversationId: "c_1", role: "assistant", content: "new-r", index: 6, personaId: "p_a" }),
    ];
    const conv = { ...CONV, compactionFloorIndex: 5 };
    const r = buildContext({ conversation: conv, target: target(), messages: msgs, personas: [persona()] });
    expect(r.messages.map((m) => m.content)).toEqual(["new", "new-r"]);
  });

  it("pinned messages below floor are also excluded", () => {
    const msgs = [
      makeMessage({ conversationId: "c_1", role: "user", content: "pin", index: 1, pinned: true, pinTarget: "p_a" }),
      makeMessage({ conversationId: "c_1", role: "user", content: "after", index: 5 }),
    ];
    const conv = { ...CONV, compactionFloorIndex: 5 };
    const r = buildContext({ conversation: conv, target: target(), messages: msgs, personas: [persona()] });
    expect(r.messages.map((m) => m.content)).toEqual(["after"]);
  });
});
