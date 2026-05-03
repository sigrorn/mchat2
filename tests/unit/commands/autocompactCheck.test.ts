// Autocompact check tests — issues #105, #118.
import { describe, it, expect } from "vitest";
import {
  resolveAutocompactTokens,
  pendingWarnings,
  personasAtThreshold,
  autocompactTriggers,
  tightestPersonaNames,
  type PersonaUsage,
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
  deletedAt: null,
  apertusProductId: null,
  visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
};

const PERSONA_200K: Persona = {
  ...PERSONA_128K,
  id: "p2",
  provider: "claude",
  name: "Claude",
  nameSlug: "claude",
};

function usage(persona: Persona, tokens: number, maxTokens: number): PersonaUsage {
  return { persona, tokens, maxTokens };
}

describe("resolveAutocompactTokens (kTokens mode, absolute)", () => {
  it("returns null when autocompact is off", () => {
    expect(resolveAutocompactTokens(BASE_CONV)).toBeNull();
  });

  it("kTokens mode: returns value * 1000", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "kTokens" as const, value: 48 } };
    expect(resolveAutocompactTokens(conv)).toBe(48000);
  });

  it("percent mode: returns null (caller must use per-persona check)", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "percent" as const, value: 75 } };
    expect(resolveAutocompactTokens(conv)).toBeNull();
  });
});

describe("pendingWarnings (#118: per-persona ratios)", () => {
  it("returns empty when autocompact is on", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "kTokens" as const, value: 48 } };
    // Persona at 100% of its max — still no warning because autocompact handles it.
    const usages = [usage(PERSONA_128K, 128000, 128000)];
    expect(pendingWarnings(conv, usages)).toEqual([]);
  });

  it("fires 80% warning when any persona is at 80% of ITS OWN max", () => {
    // GPT 128k at 80% = 102400.
    const usages = [usage(PERSONA_128K, 102400, 128000)];
    expect(pendingWarnings(BASE_CONV, usages)).toEqual([80]);
  });

  it("fires 80%/90% at once if a persona jumps past both", () => {
    const usages = [usage(PERSONA_128K, 115200, 128000)]; // 90%
    expect(pendingWarnings(BASE_CONV, usages)).toEqual([80, 90]);
  });

  it("fires all three at 98%+", () => {
    const usages = [usage(PERSONA_128K, 125440, 128000)]; // 98%
    expect(pendingWarnings(BASE_CONV, usages)).toEqual([80, 90, 98]);
  });

  it("does not repeat already-fired thresholds", () => {
    const conv = { ...BASE_CONV, contextWarningsFired: [80] };
    const usages = [usage(PERSONA_128K, 116000, 128000)]; // ~90.6%
    expect(pendingWarnings(conv, usages)).toEqual([90]);
  });

  it("returns empty when no persona crosses any threshold", () => {
    const usages = [usage(PERSONA_128K, 50000, 128000)]; // 39%
    expect(pendingWarnings(BASE_CONV, usages)).toEqual([]);
  });

  it("mixed-window scenario from #118: no warning despite one large context", () => {
    // 21k tokens vs 128k OpenAI max = 16.4% — below threshold.
    // 12k tokens vs 16k Apertus max = 75% — below threshold.
    // Neither persona crosses 80%.
    const apertus: Persona = {
      ...PERSONA_128K,
      id: "p3",
      name: "Albert",
      nameSlug: "albert",
      provider: "perplexity",
    };
    const usages = [usage(PERSONA_128K, 21000, 128000), usage(apertus, 12000, 16384)];
    expect(pendingWarnings(BASE_CONV, usages)).toEqual([]);
  });

  it("returns empty when no usages provided", () => {
    expect(pendingWarnings(BASE_CONV, [])).toEqual([]);
  });
});

describe("personasAtThreshold (#118)", () => {
  it("returns personas whose ratio >= threshold%", () => {
    const apertus: Persona = {
      ...PERSONA_128K,
      id: "p3",
      name: "Albert",
      nameSlug: "albert",
      provider: "perplexity",
    };
    const usages = [
      usage(PERSONA_128K, 50000, 128000), // 39%
      usage(apertus, 14000, 16384), // 85.4%
      usage(PERSONA_200K, 180000, 200000), // 90%
    ];
    const at80 = personasAtThreshold(80, usages);
    expect(at80.map((u) => u.persona.name)).toEqual(["Albert", "Claude"]);
  });

  it("returns empty when no persona meets the threshold", () => {
    const usages = [usage(PERSONA_128K, 50000, 128000)];
    expect(personasAtThreshold(80, usages)).toEqual([]);
  });
});

describe("autocompactTriggers (#118: per-persona)", () => {
  it("returns empty when autocompact is off", () => {
    const usages = [usage(PERSONA_128K, 128000, 128000)];
    expect(autocompactTriggers(BASE_CONV, usages)).toEqual([]);
  });

  it("kTokens mode: triggers for personas exceeding raw token count", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "kTokens" as const, value: 48 } };
    const usages = [
      usage(PERSONA_128K, 50000, 128000), // exceeds 48k
      usage(PERSONA_200K, 40000, 200000), // below 48k
    ];
    const triggered = autocompactTriggers(conv, usages);
    expect(triggered.map((u) => u.persona.name)).toEqual(["GPT"]);
  });

  it("percent mode: triggers when a persona's own ratio >= threshold%", () => {
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "percent" as const, value: 75 } };
    const usages = [
      usage(PERSONA_128K, 90000, 128000), // 70% — below
      usage(PERSONA_200K, 160000, 200000), // 80% — above
    ];
    const triggered = autocompactTriggers(conv, usages);
    expect(triggered.map((u) => u.persona.name)).toEqual(["Claude"]);
  });

  it("mixed-window scenario: large nvccoach context doesn't trigger", () => {
    // Same as the #118 example. No persona crosses 75% of its own max.
    const apertus: Persona = {
      ...PERSONA_128K,
      id: "p3",
      name: "Albert",
      nameSlug: "albert",
      provider: "perplexity",
    };
    const conv = { ...BASE_CONV, autocompactThreshold: { mode: "percent" as const, value: 75 } };
    const usages = [
      usage(PERSONA_128K, 21000, 128000), // 16%
      usage(apertus, 12000, 16384), // 73%
    ];
    expect(autocompactTriggers(conv, usages)).toEqual([]);
  });
});

describe("tightestPersonaNames", () => {
  it("returns name of the single tightest persona (#109)", () => {
    expect(tightestPersonaNames([PERSONA_128K, PERSONA_200K])).toEqual(["GPT"]);
  });

  it("returns all names tied for tightest", () => {
    const other128k: Persona = { ...PERSONA_128K, id: "p3", name: "Albert", nameSlug: "albert" };
    expect(tightestPersonaNames([PERSONA_128K, other128k, PERSONA_200K])).toEqual([
      "GPT",
      "Albert",
    ]);
  });

  it("returns empty when no personas", () => {
    expect(tightestPersonaNames([])).toEqual([]);
  });
});
