// #169 phase A — schema for the persisted openai_compat config blob.
// Held in the settings table under one key. Validates with zod and
// soft-fails to a sane empty config so a corrupt row doesn't block
// the app from loading.
import { describe, it, expect } from "vitest";
import {
  parseOpenAICompatConfig,
  EMPTY_OPENAI_COMPAT_CONFIG,
} from "@/lib/schemas/openaiCompatConfig";

describe("parseOpenAICompatConfig", () => {
  it("returns an empty config for null / missing input", () => {
    expect(parseOpenAICompatConfig(null)).toEqual(EMPTY_OPENAI_COMPAT_CONFIG);
  });

  it("returns an empty config for invalid JSON", () => {
    expect(parseOpenAICompatConfig("not json")).toEqual(EMPTY_OPENAI_COMPAT_CONFIG);
  });

  it("parses a minimal valid blob", () => {
    const json = JSON.stringify({
      builtins: {
        openrouter: {
          templateVars: {},
          extraHeaders: { "HTTP-Referer": "https://mchat2.local", "X-Title": "mchat2" },
        },
        infomaniak: {
          templateVars: { PRODUCT_ID: "abc123" },
          extraHeaders: {},
        },
      },
      customs: [
        {
          name: "my-vllm",
          baseUrl: "http://localhost:8000/v1/chat/completions",
          extraHeaders: {},
          requiresKey: false,
          supportsUsageStream: true,
        },
      ],
    });
    const cfg = parseOpenAICompatConfig(json);
    expect(cfg.builtins.openrouter?.extraHeaders["HTTP-Referer"]).toBe("https://mchat2.local");
    expect(cfg.builtins.infomaniak?.templateVars["PRODUCT_ID"]).toBe("abc123");
    expect(cfg.customs[0]?.name).toBe("my-vllm");
    expect(cfg.customs[0]?.requiresKey).toBe(false);
  });

  it("drops malformed customs while keeping valid ones", () => {
    const json = JSON.stringify({
      builtins: {},
      customs: [
        { name: "good", baseUrl: "http://localhost:8000/v1/chat/completions" },
        { name: "" }, // missing baseUrl, empty name
        { baseUrl: "http://x.example.com" }, // missing name
        "not even an object",
      ],
    });
    const cfg = parseOpenAICompatConfig(json);
    expect(cfg.customs.map((c) => c.name)).toEqual(["good"]);
  });

  it("ignores unknown built-in preset keys", () => {
    const json = JSON.stringify({
      builtins: {
        openrouter: { templateVars: {}, extraHeaders: {} },
        notarealpreset: { templateVars: { foo: "bar" }, extraHeaders: {} },
      },
      customs: [],
    });
    const cfg = parseOpenAICompatConfig(json);
    expect(cfg.builtins.openrouter).toBeDefined();
    expect((cfg.builtins as Record<string, unknown>).notarealpreset).toBeUndefined();
  });

  it("supplies sensible defaults when fields are missing", () => {
    const json = JSON.stringify({
      builtins: {},
      customs: [{ name: "minimal", baseUrl: "http://x.example.com/v1/chat/completions" }],
    });
    const cfg = parseOpenAICompatConfig(json);
    expect(cfg.customs[0]).toMatchObject({
      name: "minimal",
      baseUrl: "http://x.example.com/v1/chat/completions",
      extraHeaders: {},
      requiresKey: true,
      supportsUsageStream: true,
    });
  });
});
