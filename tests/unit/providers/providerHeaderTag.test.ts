// #203 — when an openai_compat persona produced a message, the
// header should disclose which preset was used so a 404 (or any
// other error) is attributable to the actual sub-provider, not just
// a vague "openai_compat".
import { describe, it, expect } from "vitest";
import { formatProviderTag } from "@/lib/providers/headerTag";
import type { Persona } from "@/lib/types";

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: "p1",
    conversationId: "c1",
    provider: "openai_compat",
    name: "albert",
    nameSlug: "albert",
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    ...over,
  };
}

describe("formatProviderTag", () => {
  it("returns the bare provider id for native providers", () => {
    expect(formatProviderTag("claude", null)).toBe("claude");
    expect(formatProviderTag("openai", persona({ provider: "openai" }))).toBe("openai");
  });

  it("returns 'openai_compat' alone when persona has no preset set", () => {
    expect(formatProviderTag("openai_compat", null)).toBe("openai_compat");
    expect(
      formatProviderTag("openai_compat", persona({ openaiCompatPreset: null })),
    ).toBe("openai_compat");
  });

  it("appends the built-in preset's display name in parens", () => {
    const tag = formatProviderTag(
      "openai_compat",
      persona({ openaiCompatPreset: { kind: "builtin", id: "infomaniak" } }),
    );
    expect(tag).toBe("openai_compat (Infomaniak)");
  });

  it("appends the OVHcloud preset's display name", () => {
    const tag = formatProviderTag(
      "openai_compat",
      persona({ openaiCompatPreset: { kind: "builtin", id: "ovhcloud" } }),
    );
    expect(tag).toBe("openai_compat (OVHcloud)");
  });

  it("appends the custom preset's name verbatim", () => {
    const tag = formatProviderTag(
      "openai_compat",
      persona({ openaiCompatPreset: { kind: "custom", name: "my-vllm" } }),
    );
    expect(tag).toBe("openai_compat (my-vllm)");
  });

  it("falls back to the bare id when a built-in preset id is unknown", () => {
    const tag = formatProviderTag(
      "openai_compat",
      persona({ openaiCompatPreset: { kind: "builtin", id: "no-such-preset" } }),
    );
    // Don't claim a display name we don't have; show the raw id so
    // the user can see something went wrong with the persona's config.
    expect(tag).toBe("openai_compat (no-such-preset)");
  });
});
