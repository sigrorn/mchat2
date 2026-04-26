// Tests for the per-persona compaction cutoff helper — issue #110.
// Semantics: preserve the last N non-pinned user messages visible to each
// persona; cutoff is the minimum across personas.
import { describe, it, expect } from "vitest";
import { computeCompactionCutoff } from "@/lib/conversations/compactionCutoff";
import type { Conversation, Message, Persona } from "@/lib/types";

const CONV: Conversation = {
  id: "c1",
  title: "Test",
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

function persona(id: string, overrides: Partial<Persona> = {}): Persona {
  return {
    id,
    conversationId: "c1",
    provider: "openai",
    name: id.toUpperCase(),
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null,
    ...overrides,
  };
}

function msg(
  index: number,
  role: "user" | "assistant" | "notice" | "system",
  overrides: Partial<Message> = {},
): Message {
  return {
    id: `m${index}`,
    conversationId: "c1",
    role,
    content: `content ${index}`,
    provider: role === "assistant" ? "openai" : null,
    model: role === "assistant" ? "gpt-4o" : null,
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: index * 1000,
    index,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
    ...overrides,
  };
}

describe("computeCompactionCutoff", () => {
  it("N=0 returns the index after the last message (compact everything)", () => {
    const messages = [msg(0, "user"), msg(1, "assistant", { personaId: "p1" })];
    const personas = [persona("p1")];
    expect(computeCompactionCutoff(CONV, messages, personas, 0)).toBe(2);
  });

  it("N >= visible user messages returns existing floor (nothing to compact)", () => {
    const messages = [msg(0, "user"), msg(1, "assistant", { personaId: "p1" })];
    const personas = [persona("p1")];
    expect(computeCompactionCutoff(CONV, messages, personas, 5)).toBe(0);
  });

  it("single persona, N=2 returns index of the 2nd-from-last user message", () => {
    // Indices: 0=user, 1=asst, 2=user, 3=asst, 4=user
    // User messages at indices 0, 2, 4. Last 2 user messages: 2 and 4.
    // Cutoff = index 2. Messages [2, 3, 4] are preserved.
    const messages = [
      msg(0, "user"),
      msg(1, "assistant", { personaId: "p1" }),
      msg(2, "user"),
      msg(3, "assistant", { personaId: "p1" }),
      msg(4, "user"),
    ];
    const personas = [persona("p1")];
    expect(computeCompactionCutoff(CONV, messages, personas, 2)).toBe(2);
  });

  it("two personas with different visibility, N=2 uses the minimum cutoff", () => {
    // Example from issue:
    // p1 sees user messages 53 (@all) and 55 (@all) — last 2: 53, 55 → cutoff 53
    // p2 sees user messages 53 (@all), 54 (@p2), 55 (@all) — last 2: 54, 55 → cutoff 54
    // min = 53
    const messages = [
      msg(53, "user"),
      msg(54, "user", { addressedTo: ["p2"] }),
      msg(55, "user"),
    ];
    const personas = [persona("p1"), persona("p2")];
    expect(computeCompactionCutoff(CONV, messages, personas, 2)).toBe(53);
  });

  it("pinned user messages (identity pins) are excluded from the count", () => {
    // Pinned identity message at 0 shouldn't count as a "fresh" user turn.
    const messages = [
      msg(0, "user", { pinned: true }), // identity pin — excluded
      msg(1, "user"),
      msg(2, "assistant", { personaId: "p1" }),
      msg(3, "user"),
      msg(4, "assistant", { personaId: "p1" }),
      msg(5, "user"),
    ];
    const personas = [persona("p1")];
    // Non-pinned user messages: 1, 3, 5. Last 2: 3, 5. Cutoff = 3.
    expect(computeCompactionCutoff(CONV, messages, personas, 2)).toBe(3);
  });

  it("respects existing compactionFloorIndex as a lower bound", () => {
    const messages = [
      msg(0, "user"),
      msg(1, "user"),
      msg(2, "user"),
      msg(3, "user"),
      msg(4, "user"),
    ];
    const conv = { ...CONV, compactionFloorIndex: 2 };
    const personas = [persona("p1")];
    // Floor at 2: user messages visible from 2 onwards: 2, 3, 4.
    // Last 2: 3, 4. Cutoff = 3.
    expect(computeCompactionCutoff(conv, messages, personas, 2)).toBe(3);
  });

  it("falls back to existing floor when a persona has < N user messages", () => {
    const messages = [msg(0, "user"), msg(1, "user"), msg(2, "user")];
    const conv = { ...CONV, compactionFloorIndex: 2 };
    const personas = [persona("p1")];
    // Floor at 2: only msg 2 visible. N=5 > visible count → cutoff = floor (2).
    expect(computeCompactionCutoff(conv, messages, personas, 5)).toBe(2);
  });

  it("no personas returns length (nothing to do)", () => {
    const messages = [msg(0, "user")];
    expect(computeCompactionCutoff(CONV, messages, [], 2)).toBe(1);
  });

  it("empty message list returns 0", () => {
    expect(computeCompactionCutoff(CONV, [], [persona("p1")], 2)).toBe(0);
  });
});
