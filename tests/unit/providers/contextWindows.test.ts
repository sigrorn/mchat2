// ------------------------------------------------------------------
// Component: contextWindows resolver tests (#261)
// Responsibility: Pin per-model context-window lookup behaviour for the
//                 four PROVIDER_REGISTRY-shaped consumer paths
//                 (autocompact, runCompaction, postResponseCheck, stats).
//                 The resolver is the fix for openai_compat reporting
//                 unlimited regardless of preset/model.
// ------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  maxContextTokensForPersona,
  maxContextTokensForProviderModel,
} from "@/lib/providers/contextWindows";
import type { Persona } from "@/lib/types";

function makePersona(over: Partial<Persona>): Persona {
  return {
    id: "p_test",
    conversationId: "c_test",
    provider: "claude",
    name: "test",
    nameSlug: "test",
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
    ...over,
  };
}

describe("maxContextTokensForProviderModel", () => {
  it("returns the per-model entry when present (Apertus 70B 2509)", () => {
    // The native apertus adapter (pre-#257) carried 16384 as its
    // hard cap, set in response to an HTTP 400 from #55. Empirically
    // retested 2026-05-03 with a ~22k-token sentinel prompt: wire
    // accepted, model recalled a codeword from the head of the
    // prompt — confirms Infomaniak's current Apertus 2509 deployment
    // honors the full 64k upstream window.
    expect(
      maxContextTokensForProviderModel("openai_compat", "swiss-ai/Apertus-70B-Instruct-2509"),
    ).toBe(65536);
  });

  it("falls back to provider-level default when the model is not in the table", () => {
    // Unknown openai_compat model has no entry; provider-level value
    // is Infinity. Caller still gets Infinity — but the path is
    // resolver-driven now, which lets the table grow without further
    // call-site changes.
    expect(maxContextTokensForProviderModel("openai_compat", "unknown-vendor/unknown-model")).toBe(
      Infinity,
    );
  });

  it("falls back to provider-level default when the model is null or empty", () => {
    expect(maxContextTokensForProviderModel("claude", null)).toBe(200000);
    expect(maxContextTokensForProviderModel("claude", "")).toBe(200000);
  });

  it("returns the provider-level value for native providers (no per-model overrides)", () => {
    // Native providers' maxContextTokens is correct at the provider
    // level — one model family per provider. The resolver shouldn't
    // change anything for them.
    expect(maxContextTokensForProviderModel("claude", "claude-sonnet-4-6")).toBe(200000);
    expect(maxContextTokensForProviderModel("openai", "gpt-4o")).toBe(128000);
    expect(maxContextTokensForProviderModel("perplexity", "llama-3.1-sonar-large-128k-online")).toBe(
      127072,
    );
  });
});

describe("maxContextTokensForPersona", () => {
  it("uses the persona's modelOverride when set", () => {
    const persona = makePersona({
      provider: "openai_compat",
      modelOverride: "swiss-ai/Apertus-70B-Instruct-2509",
    });
    expect(maxContextTokensForPersona(persona)).toBe(65536);
  });

  it("falls back to the provider's defaultModel when modelOverride is null", () => {
    // claude default is claude-sonnet-4-6; no per-model entry → uses
    // provider-level 200000.
    const persona = makePersona({ provider: "claude", modelOverride: null });
    expect(maxContextTokensForPersona(persona)).toBe(200000);
  });

  it("returns Infinity for an openai_compat persona with an unknown model", () => {
    // Regression guard: per-model lookup miss must not silently report
    // a tighter window than reality. Falls through to the provider
    // default (Infinity) so call sites can decide what to do.
    const persona = makePersona({
      provider: "openai_compat",
      modelOverride: "made-up/never-shipped",
    });
    expect(maxContextTokensForPersona(persona)).toBe(Infinity);
  });
});
