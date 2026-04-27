// #169 phase A — built-in preset registry.
// Each entry must declare urlTemplate, templateVars, hostingCountry,
// supportsUsageStream, registrationUrl, and any extraHeaders the
// dialog should pre-populate (OpenRouter's HTTP-Referer/X-Title).
import { describe, it, expect } from "vitest";
import {
  BUILTIN_OPENAI_COMPAT_PRESETS,
  builtinPresetById,
  resolveTemplateUrl,
} from "@/lib/providers/openaiCompatPresets";

describe("BUILTIN_OPENAI_COMPAT_PRESETS", () => {
  it("ships exactly the four presets locked in the design spec (#140)", () => {
    const ids = BUILTIN_OPENAI_COMPAT_PRESETS.map((p) => p.id);
    expect(ids).toEqual(["openrouter", "ovhcloud", "ionos", "infomaniak"]);
  });

  it("every preset has urlTemplate, templateVars, hostingCountry, registrationUrl", () => {
    for (const p of BUILTIN_OPENAI_COMPAT_PRESETS) {
      expect(p.urlTemplate, `${p.id} urlTemplate`).toMatch(/^https?:\/\//);
      expect(Array.isArray(p.templateVars), `${p.id} templateVars`).toBe(true);
      expect(p.hostingCountry, `${p.id} hostingCountry`).toMatch(/^[A-Z]{2}$/);
      expect(p.registrationUrl, `${p.id} registrationUrl`).toMatch(/^https?:\/\//);
    }
  });

  it("Infomaniak is the only preset with a {PRODUCT_ID} placeholder", () => {
    const infomaniak = builtinPresetById("infomaniak");
    expect(infomaniak?.templateVars).toContain("PRODUCT_ID");
    expect(infomaniak?.urlTemplate).toContain("{PRODUCT_ID}");
    for (const id of ["openrouter", "ovhcloud", "ionos"] as const) {
      const p = builtinPresetById(id);
      expect(p?.templateVars).toEqual([]);
      expect(p?.urlTemplate).not.toMatch(/\{[A-Z_]+\}/);
    }
  });

  it("OpenRouter declares HTTP-Referer + X-Title as supported optional headers", () => {
    const openrouter = builtinPresetById("openrouter");
    expect(openrouter?.optionalHeaders).toEqual(
      expect.arrayContaining(["HTTP-Referer", "X-Title"]),
    );
  });

  it("hosting countries match the #140 spec table", () => {
    expect(builtinPresetById("openrouter")?.hostingCountry).toBe("US");
    expect(builtinPresetById("ovhcloud")?.hostingCountry).toBe("FR");
    expect(builtinPresetById("ionos")?.hostingCountry).toBe("DE");
    expect(builtinPresetById("infomaniak")?.hostingCountry).toBe("CH");
  });

  it("builtinPresetById returns null for unknown ids", () => {
    expect(builtinPresetById("nope")).toBeNull();
  });
});

describe("resolveTemplateUrl", () => {
  it("returns the template unchanged when there are no placeholders", () => {
    expect(resolveTemplateUrl("https://api.example.com/v1/chat/completions", {})).toBe(
      "https://api.example.com/v1/chat/completions",
    );
  });

  it("substitutes {PRODUCT_ID} with the supplied value", () => {
    expect(
      resolveTemplateUrl("https://api.infomaniak.com/2/ai/{PRODUCT_ID}/openai/v1/chat/completions", {
        PRODUCT_ID: "abc123",
      }),
    ).toBe("https://api.infomaniak.com/2/ai/abc123/openai/v1/chat/completions");
  });

  it("URL-encodes the substituted value so a slash inside it doesn't break the path", () => {
    expect(
      resolveTemplateUrl("https://api.example.com/{PROJECT_ID}/v1/chat/completions", {
        PROJECT_ID: "team/sub",
      }),
    ).toBe("https://api.example.com/team%2Fsub/v1/chat/completions");
  });

  it("leaves a placeholder in place if the var is missing (so the call surfaces a real error)", () => {
    expect(
      resolveTemplateUrl("https://api.example.com/{MISSING}/v1/chat/completions", {}),
    ).toBe("https://api.example.com/{MISSING}/v1/chat/completions");
  });
});
