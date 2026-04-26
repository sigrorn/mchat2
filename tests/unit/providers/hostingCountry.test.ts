// #141 phase 1 — hosting-country indicator. Each provider declares an
// ISO 3166 alpha-2 hosting code; UI surfaces wrap it in `[XX]` to
// dodge the Windows-flag-emoji rendering wrinkle (Windows ships no
// flag glyphs and would render `🇨🇭` as the literal letters CH).
import { describe, it, expect } from "vitest";
import { formatHostingTag } from "@/lib/providers/derived";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";

describe("formatHostingTag", () => {
  it("wraps a code in brackets and uppercases it", () => {
    expect(formatHostingTag("ch")).toBe("[CH]");
    expect(formatHostingTag("FR")).toBe("[FR]");
    expect(formatHostingTag("us")).toBe("[US]");
  });

  it("returns empty string for null", () => {
    expect(formatHostingTag(null)).toBe("");
  });

  it("returns empty string for an empty code", () => {
    expect(formatHostingTag("")).toBe("");
  });
});

describe("PROVIDER_REGISTRY hostingCountry assignments", () => {
  it("every selectable provider has a hostingCountry set (mock may be null)", () => {
    for (const [id, meta] of Object.entries(PROVIDER_REGISTRY)) {
      if (id === "mock") continue;
      expect(meta.hostingCountry, `${id} missing hostingCountry`).toBeTruthy();
      expect(meta.hostingCountry).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("Mistral hosts in FR, Apertus/Infomaniak in CH, Anthropic/OpenAI/Gemini/Perplexity in US", () => {
    expect(PROVIDER_REGISTRY.mistral.hostingCountry).toBe("FR");
    expect(PROVIDER_REGISTRY.apertus.hostingCountry).toBe("CH");
    expect(PROVIDER_REGISTRY.claude.hostingCountry).toBe("US");
    expect(PROVIDER_REGISTRY.openai.hostingCountry).toBe("US");
    expect(PROVIDER_REGISTRY.gemini.hostingCountry).toBe("US");
    expect(PROVIDER_REGISTRY.perplexity.hostingCountry).toBe("US");
  });

  it("mock has no hosting country (not a real hosted provider)", () => {
    expect(PROVIDER_REGISTRY.mock.hostingCountry).toBeNull();
  });
});
