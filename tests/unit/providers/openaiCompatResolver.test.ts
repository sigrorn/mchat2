// #169 phase A — resolver that joins a preset ref with the persisted
// config and the keychain into the bag of values the adapter reads
// from extraConfig at call time.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { __setImpl as setKc } from "@/lib/tauri/keychain";
import {
  setBuiltinPresetConfig,
  upsertCustomPreset,
  setApiKeyForPreset,
} from "@/lib/providers/openaiCompatStorage";
import { resolveOpenAICompatPreset } from "@/lib/providers/openaiCompatResolver";

let handle: TestDbHandle | null = null;
let kc: Map<string, string>;

beforeEach(async () => {
  handle = await createTestDb();
  kc = new Map();
  setKc({
    get: async (k) => kc.get(k) ?? null,
    set: async (k, v) => {
      kc.set(k, v);
    },
    remove: async (k) => {
      kc.delete(k);
    },
    list: async () => [...kc.keys()],
  });
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("resolveOpenAICompatPreset (built-in presets)", () => {
  it("returns null for an unknown built-in id", async () => {
    expect(await resolveOpenAICompatPreset({ kind: "builtin", id: "no-such-preset" })).toBeNull();
  });

  it("returns the static URL for a no-template preset (OpenRouter), with no api key", async () => {
    const r = await resolveOpenAICompatPreset({ kind: "builtin", id: "openrouter" });
    expect(r).toMatchObject({
      url: "https://openrouter.ai/api/v1/chat/completions",
      requiresKey: true,
      supportsUsageStream: true,
      apiKey: null,
    });
  });

  it("substitutes the templateVars on the Infomaniak URL", async () => {
    await setBuiltinPresetConfig("infomaniak", {
      templateVars: { PRODUCT_ID: "p123" },
      extraHeaders: {},
    });
    const r = await resolveOpenAICompatPreset({ kind: "builtin", id: "infomaniak" });
    expect(r?.url).toBe(
      "https://api.infomaniak.com/1/ai/p123/openai/v1/chat/completions",
    );
  });

  it("returns the user-saved API key for a built-in preset", async () => {
    await setApiKeyForPreset({ kind: "builtin", id: "ionos" }, "sk-ionos-test");
    const r = await resolveOpenAICompatPreset({ kind: "builtin", id: "ionos" });
    expect(r?.apiKey).toBe("sk-ionos-test");
  });

  it("merges saved extraHeaders onto an OpenRouter resolve", async () => {
    await setBuiltinPresetConfig("openrouter", {
      templateVars: {},
      extraHeaders: { "HTTP-Referer": "https://mchat2.local", "X-Title": "mchat2" },
    });
    const r = await resolveOpenAICompatPreset({ kind: "builtin", id: "openrouter" });
    expect(r?.extraHeaders).toEqual({
      "HTTP-Referer": "https://mchat2.local",
      "X-Title": "mchat2",
    });
  });
});

describe("resolveOpenAICompatPreset (custom presets)", () => {
  it("returns null when the named custom doesn't exist", async () => {
    expect(await resolveOpenAICompatPreset({ kind: "custom", name: "missing" })).toBeNull();
  });

  it("returns the saved baseUrl, headers, and key for a custom preset", async () => {
    await upsertCustomPreset({
      name: "my-vllm",
      baseUrl: "http://localhost:8000/v1/chat/completions",
      extraHeaders: { "X-Hint": "hi" },
      requiresKey: false,
      supportsUsageStream: true,
    });
    await setApiKeyForPreset({ kind: "custom", name: "my-vllm" }, "sk-local");
    const r = await resolveOpenAICompatPreset({ kind: "custom", name: "my-vllm" });
    expect(r).toEqual({
      url: "http://localhost:8000/v1/chat/completions",
      extraHeaders: { "X-Hint": "hi" },
      requiresKey: false,
      supportsUsageStream: true,
      apiKey: "sk-local",
      hostingCountry: null,
    });
  });
});
