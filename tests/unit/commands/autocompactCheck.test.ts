// Autocompact check tests — issue #105.
import { describe, it, expect } from "vitest";
import {
  resolveAutocompactTokens,
  pendingWarnings,
} from "@/lib/commands/autocompactCheck";
import type { Conversation, Persona } from "@/lib/types";

const BASE_CONV: Conversation = {
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

const PERSONA_128K: Persona = {
  id: "p1",
  conversationId: "c1",
  provider: "openai",
  name: "GPT",
  nameSlug: "gpt",
  systemPromptOverride: null,
  modelOverride: null,
  colorOverride: null,
  createdAtMessageIndex: 0,
  sortOrder: 0,
  runsAfter: [],
  deletedAt: null,
  apertusProductId: null,
  visibilityDefaults: {},
};

const PERSONA_200K: Persona = {
  ...PERSONA_128K,
  id: "p2",
  provider: "claude",
  name: "Claude",
  nameSlug: "claude",
};

describe("resolveAutocompactTokens", () => {
  it("returns null when autocompact is off", () => {
    expect(resolveAutocompactTokens(BASE_CONV, [PERSONA_128K])).toBeNull();
  });

  it("kTokens mode: returns value * 1000", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "kTokens" as const, value: 48 } };
    expect(resolveAutocompactTokens(conv, [PERSONA_128K])).toBe(48000);
  });

  it("percent mode: resolves against tightest model", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "percent" as const, value: 75 } };
    // 75% of 128000 = 96000
    expect(resolveAutocompactTokens(conv, [PERSONA_128K, PERSONA_200K])).toBe(96000);
  });

  it("percent mode with only 200k model: 75% = 150000", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "percent" as const, value: 75 } };
    expect(resolveAutocompactTokens(conv, [PERSONA_200K])).toBe(150000);
  });

  it("returns null when no personas", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "percent" as const, value: 75 } };
    expect(resolveAutocompactTokens(conv, [])).toBeNull();
  });
});

describe("pendingWarnings", () => {
  it("returns empty when autocompact is on", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "kTokens" as const, value: 48 } };
    expect(pendingWarnings(conv, 200000, [PERSONA_128K])).toEqual([]);
  });

  it("fires 80% warning when context reaches 80% of tightest model", () => {
    // 80% of 128000 = 102400
    expect(pendingWarnings(BASE_CONV, 102400, [PERSONA_128K])).toEqual([80]);
  });

  it("fires 80% and 90% at once if context jumps past both", () => {
    // 90% of 128000 = 115200
    expect(pendingWarnings(BASE_CONV, 115200, [PERSONA_128K])).toEqual([80, 90]);
  });

  it("fires all three at 98%+", () => {
    // 98% of 128000 = 125440
    expect(pendingWarnings(BASE_CONV, 125440, [PERSONA_128K])).toEqual([80, 90, 98]);
  });

  it("does not repeat already-fired warnings", () => {
    const conv = { ...BASE_CONV, contextWarningsFired: [80] };
    // past 90% threshold
    expect(pendingWarnings(conv, 116000, [PERSONA_128K])).toEqual([90]);
  });

  it("returns empty when below all thresholds", () => {
    expect(pendingWarnings(BASE_CONV, 50000, [PERSONA_128K])).toEqual([]);
  });

  it("returns empty when no personas", () => {
    expect(pendingWarnings(BASE_CONV, 200000, [])).toEqual([]);
  });
});
