// Tests for the per-persona compaction cutoff helper — issue #110.
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
    visibilityDefaults: {},
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
  it("N=0 returns the length of messages (compact everything)", () => {
    const messages = [msg(0, "user"), msg(1, "assistant", { personaId: "p1" })];
    const personas = [persona("p1")];
    expect(computeCompactionCutoff(CONV, messages, personas, 0)).toBe(2);
  });

  it("N >= visible messages returns 0 (nothing to compact)", () => {
    const messages = [msg(0, "user"), msg(1, "assistant", { personaId: "p1" })];
    const personas = [persona("p1")];
    expect(computeCompactionCutoff(CONV, messages, personas, 5)).toBe(0);
  });

  it("single persona, N=2 returns the index of the 2nd-from-last visible", () => {
    // Indices: 0=user, 1=asst, 2=user, 3=asst, 4=user
    // All visible to p1. Last 2 visible: indices 3, 4. Cutoff = index 3.
    const messages = [
      msg(0, "user"),
      msg(1, "assistant", { personaId: "p1" }),
      msg(2, "user"),
      msg(3, "assistant", { personaId: "p1" }),
      msg(4, "user"),
    ];
    const personas = [persona("p1")];
    expect(computeCompactionCutoff(CONV, messages, personas, 2)).toBe(3);
  });

  it("two personas with different visibility, N=2 uses the minimum cutoff", () => {
    // Scenario from issue:
    // p1 sees: msg 53 (addressed @all), msg 55 (@all)
    // p2 sees: msg 53 (@all), msg 54 (@p2 only), msg 55 (@all)
    // N=2:
    //   p1's last 2 visible: 53, 55 → cutoff 53
    //   p2's last 2 visible: 54, 55 → cutoff 54
    // min = 53
    const messages = [
      msg(53, "user"),
      msg(54, "user", { addressedTo: ["p2"] }),
      msg(55, "user"),
    ];
    const personas = [persona("p1"), persona("p2")];
    expect(computeCompactionCutoff(CONV, messages, personas, 2)).toBe(53);
  });

  it("notices and failed assistants are skipped in the count", () => {
    const messages = [
      msg(0, "user"),
      msg(1, "notice"),
      msg(2, "assistant", { personaId: "p1", errorMessage: "failed" }),
      msg(3, "assistant", { personaId: "p1" }),
      msg(4, "user"),
    ];
    const personas = [persona("p1")];
    // Visible: indices 0, 3, 4 (notice + failed skipped)
    // Last 2 visible: 3, 4 → cutoff 3
    expect(computeCompactionCutoff(CONV, messages, personas, 2)).toBe(3);
  });

  it("respects an existing compactionFloorIndex as a lower bound", () => {
    const messages = [
      msg(0, "user"),
      msg(1, "user"),
      msg(2, "user"),
      msg(3, "user"),
      msg(4, "user"),
    ];
    const conv = { ...CONV, compactionFloorIndex: 2 };
    const personas = [persona("p1")];
    // Floor at 2: visible from 2 onwards. Last 2: indices 3, 4 → cutoff 3.
    expect(computeCompactionCutoff(conv, messages, personas, 2)).toBe(3);
  });

  it("cutoff never goes below existing compactionFloorIndex", () => {
    const messages = [msg(0, "user"), msg(1, "user"), msg(2, "user")];
    const conv = { ...CONV, compactionFloorIndex: 2 };
    const personas = [persona("p1")];
    // Only msg 2 visible. N=5 > visible count → cutoff = floor (2), no compaction happens.
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
