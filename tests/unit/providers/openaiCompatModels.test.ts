// #203 — openai_compat persona model picker should populate from
// the resolved preset's /v1/models endpoint when one exists, and
// fall back to an empty list (free-text input) when it doesn't.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl as setHttp, __resetImpl as resetHttp } from "@/lib/tauri/http";
import { __setImpl as setKc } from "@/lib/tauri/keychain";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import {
  setBuiltinPresetConfig,
  setApiKeyForPreset,
  upsertCustomPreset,
} from "@/lib/providers/openaiCompatStorage";
import {
  listModelInfos,
  __clearModelCache,
  subscribeModelCache,
} from "@/lib/providers/models";

interface MockHttpReq {
  url: string;
  method: string | undefined;
  headers: Record<string, string> | undefined;
}

let handle: TestDbHandle | null = null;
let httpCalls: MockHttpReq[];
let httpResponse: { status: number; body: string };

function installHttpMock(): void {
  setHttp({
    async *streamSSE() {
      // not exercised by listModelInfos
    },
    async request(opts) {
      httpCalls.push({ url: opts.url, method: opts.method, headers: opts.headers });
      return { status: httpResponse.status, body: httpResponse.body, headers: {} };
    },
  });
}

function installKeychainMock(): void {
  const store = new Map<string, string>();
  setKc({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    remove: async (k) => {
      store.delete(k);
    },
    list: async () => [...store.keys()],
  });
}

beforeEach(async () => {
  handle = await createTestDb();
  installHttpMock();
  installKeychainMock();
  httpCalls = [];
  httpResponse = { status: 200, body: "" };
  __clearModelCache();
});
afterEach(() => {
  handle?.restore();
  handle = null;
  resetHttp();
});

describe("listModelInfos for openai_compat (#203)", () => {
  it("returns empty when persona has no openaiCompatPreset", async () => {
    const infos = await listModelInfos("openai_compat", "k", {});
    expect(infos).toEqual([]);
    expect(httpCalls).toHaveLength(0);
  });

  it("derives the /v1/models URL from the resolved chat URL and fetches", async () => {
    await setBuiltinPresetConfig("infomaniak", {
      templateVars: { PRODUCT_ID: "p123" },
      extraHeaders: {},
    });
    await setApiKeyForPreset({ kind: "builtin", id: "infomaniak" }, "sk-test");
    httpResponse = {
      status: 200,
      body: JSON.stringify({
        data: [
          { id: "swiss-ai/Apertus-70B-Instruct-2509" },
          { id: "openai/gpt-oss-120b" },
        ],
      }),
    };
    const infos = await listModelInfos("openai_compat", null, {
      openaiCompatPreset: { kind: "builtin", id: "infomaniak" },
    });
    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0]?.url).toBe(
      "https://api.infomaniak.com/2/ai/p123/openai/v1/models",
    );
    expect(httpCalls[0]?.headers?.["authorization"]).toBe("Bearer sk-test");
    expect(infos.map((m) => m.id)).toContain("swiss-ai/Apertus-70B-Instruct-2509");
    expect(infos.map((m) => m.id)).toContain("openai/gpt-oss-120b");
  });

  it("falls back to empty (free-text input) when /v1/models returns 404", async () => {
    await setBuiltinPresetConfig("infomaniak", {
      templateVars: { PRODUCT_ID: "p123" },
      extraHeaders: {},
    });
    await setApiKeyForPreset({ kind: "builtin", id: "infomaniak" }, "sk-test");
    httpResponse = { status: 404, body: "not found" };
    const infos = await listModelInfos("openai_compat", null, {
      openaiCompatPreset: { kind: "builtin", id: "infomaniak" },
    });
    // Empty pricing fallback for openai_compat → empty list, picker
    // stays open and the user can free-text-type the model name.
    expect(infos).toEqual([]);
  });

  it("forwards preset extraHeaders so OpenRouter-style auth works for model listing", async () => {
    await setBuiltinPresetConfig("openrouter", {
      templateVars: {},
      extraHeaders: { "HTTP-Referer": "https://mchat2.local", "X-Title": "mchat2" },
    });
    await setApiKeyForPreset({ kind: "builtin", id: "openrouter" }, "sk-or");
    httpResponse = { status: 200, body: JSON.stringify({ data: [{ id: "anthropic/claude-3-7-sonnet" }] }) };
    await listModelInfos("openai_compat", null, {
      openaiCompatPreset: { kind: "builtin", id: "openrouter" },
    });
    expect(httpCalls[0]?.headers?.["HTTP-Referer"]).toBe("https://mchat2.local");
    expect(httpCalls[0]?.headers?.["X-Title"]).toBe("mchat2");
  });

  it("parses OpenRouter context_length + pricing into ModelInfo (#298)", async () => {
    await setBuiltinPresetConfig("openrouter", { templateVars: {}, extraHeaders: {} });
    await setApiKeyForPreset({ kind: "builtin", id: "openrouter" }, "sk-or");
    httpResponse = {
      status: 200,
      body: JSON.stringify({
        data: [
          {
            id: "anthropic/claude-haiku",
            context_length: 200000,
            // OpenRouter reports USD per token as strings.
            pricing: { prompt: "0.0000008", completion: "0.000004" },
          },
        ],
      }),
    };
    const infos = await listModelInfos("openai_compat", null, {
      openaiCompatPreset: { kind: "builtin", id: "openrouter" },
    });
    expect(infos[0]?.id).toBe("anthropic/claude-haiku");
    expect(infos[0]?.maxTokens).toBe(200000);
    // USD per token → per Mtok; tolerate float rounding (0.0000008 * 1e6).
    expect(infos[0]?.inputUsdPerMTok).toBeCloseTo(0.8, 6);
    expect(infos[0]?.outputUsdPerMTok).toBeCloseTo(4, 6);
  });

  it("works for custom presets", async () => {
    await upsertCustomPreset({
      name: "local-vllm",
      baseUrl: "http://localhost:8000/v1/chat/completions",
      extraHeaders: {},
      requiresKey: false,
      supportsUsageStream: true,
    });
    httpResponse = { status: 200, body: JSON.stringify({ data: [{ id: "llama-3.3" }] }) };
    const infos = await listModelInfos("openai_compat", null, {
      openaiCompatPreset: { kind: "custom", name: "local-vllm" },
    });
    expect(httpCalls[0]?.url).toBe("http://localhost:8000/v1/models");
    expect(infos.map((m) => m.id)).toContain("llama-3.3");
  });
});

async function waitFor(pred: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("listModelInfos persistent cache (#297)", () => {
  const preset = { kind: "builtin" as const, id: "openrouter" };

  async function configure(): Promise<void> {
    await setBuiltinPresetConfig("openrouter", { templateVars: {}, extraHeaders: {} });
    await setApiKeyForPreset(preset, "sk-or");
  }

  it("serves the persisted list after the in-memory cache is cleared, even when the network then fails", async () => {
    await configure();
    httpResponse = {
      status: 200,
      body: JSON.stringify({ data: [{ id: "anthropic/claude-3-7" }, { id: "openai/gpt-4o" }] }),
    };
    const first = await listModelInfos("openai_compat", null, { openaiCompatPreset: preset });
    expect(first.map((m) => m.id)).toEqual(["anthropic/claude-3-7", "openai/gpt-4o"]);
    expect(httpCalls).toHaveLength(1);

    // Simulate a restart: in-memory cache gone, network now down.
    __clearModelCache();
    httpResponse = { status: 500, body: "boom" };

    const afterRestart = await listModelInfos("openai_compat", null, {
      openaiCompatPreset: preset,
    });
    // Must come from the persisted disk cache, NOT an empty fallback.
    expect(afterRestart.map((m) => m.id)).toEqual(["anthropic/claude-3-7", "openai/gpt-4o"]);
  });

  it("revalidates in the background and notifies subscribers when the list changes", async () => {
    await configure();
    httpResponse = { status: 200, body: JSON.stringify({ data: [{ id: "model-a" }] }) };
    const first = await listModelInfos("openai_compat", null, { openaiCompatPreset: preset });
    expect(first.map((m) => m.id)).toEqual(["model-a"]);

    // Restart with a richer upstream list.
    __clearModelCache();
    httpResponse = { status: 200, body: JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }) };

    let notified = false;
    const unsub = subscribeModelCache(() => {
      notified = true;
    });

    // Stale-while-revalidate: returns the persisted list instantly.
    const stale = await listModelInfos("openai_compat", null, { openaiCompatPreset: preset });
    expect(stale.map((m) => m.id)).toEqual(["model-a"]);

    // Background refresh fires the network call and notifies on change.
    await waitFor(() => notified);
    unsub();

    const fresh = await listModelInfos("openai_compat", null, { openaiCompatPreset: preset });
    expect(fresh.map((m) => m.id)).toEqual(["model-a", "model-b"]);
  });
});
