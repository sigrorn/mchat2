// #67 — Show per-model token limit in the model picker.
import { describe, it, expect } from "vitest";
import {
  formatTokenLimit,
  formatModelMeta,
  type ModelInfo,
} from "@/lib/providers/models";

describe("formatTokenLimit (#67)", () => {
  it("formats 128000 as 128k", () => {
    expect(formatTokenLimit(128000)).toBe("128k");
  });

  it("formats 1048576 as 1049k", () => {
    expect(formatTokenLimit(1048576)).toBe("1049k");
  });

  it("formats 8192 as 8k", () => {
    expect(formatTokenLimit(8192)).toBe("8k");
  });

  it("formats undefined as empty", () => {
    expect(formatTokenLimit(undefined)).toBe("");
  });
});

describe("ModelInfo type", () => {
  it("can carry id and optional maxTokens", () => {
    const m: ModelInfo = { id: "gpt-4o", maxTokens: 128000 };
    expect(m.id).toBe("gpt-4o");
    expect(m.maxTokens).toBe(128000);
  });

  it("maxTokens is optional", () => {
    const m: ModelInfo = { id: "unknown-model" };
    expect(m.maxTokens).toBeUndefined();
  });

  it("can carry per-million-token prices", () => {
    const m: ModelInfo = {
      id: "x",
      inputUsdPerMTok: 0.8,
      outputUsdPerMTok: 4,
    };
    expect(m.inputUsdPerMTok).toBe(0.8);
    expect(m.outputUsdPerMTok).toBe(4);
  });
});

describe("formatModelMeta (#298)", () => {
  it("formats explicit prices + context", () => {
    const m: ModelInfo = {
      id: "anthropic/claude-x",
      inputUsdPerMTok: 0.8,
      outputUsdPerMTok: 4,
      maxTokens: 200000,
    };
    expect(formatModelMeta("openai_compat", m)).toBe("$0.8/$4 per Mtok · 200k ctx");
  });

  it("falls back to the static pricing table when ModelInfo has no prices", () => {
    // claude-sonnet-4-6 lives in PRICING.claude (3 / 15).
    expect(formatModelMeta("claude", { id: "claude-sonnet-4-6" })).toBe("$3/$15 per Mtok");
  });

  it("shows 'free' when both prices are zero", () => {
    const m: ModelInfo = {
      id: "free-model",
      inputUsdPerMTok: 0,
      outputUsdPerMTok: 0,
      maxTokens: 128000,
    };
    expect(formatModelMeta("openai_compat", m)).toBe("free · 128k ctx");
  });

  it("shows context alone when no price is known", () => {
    expect(formatModelMeta("openai_compat", { id: "x", maxTokens: 1000 })).toBe("1k ctx");
  });

  it("returns empty string when nothing is known", () => {
    expect(formatModelMeta("openai_compat", { id: "mystery" })).toBe("");
  });

  it("appends the AA intelligence score when supplied (#299)", () => {
    const m: ModelInfo = {
      id: "anthropic/claude-x",
      inputUsdPerMTok: 0.8,
      outputUsdPerMTok: 4,
      maxTokens: 200000,
    };
    expect(formatModelMeta("openai_compat", m, 64)).toBe("$0.8/$4 per Mtok · 200k ctx · AA 64");
  });

  it("rounds the AA score and shows it even with no other metadata", () => {
    expect(formatModelMeta("openai_compat", { id: "x" }, 63.7)).toBe("AA 64");
  });

  it("omits the AA segment when the score is undefined", () => {
    expect(formatModelMeta("claude", { id: "claude-sonnet-4-6" }, undefined)).toBe(
      "$3/$15 per Mtok",
    );
  });
});
