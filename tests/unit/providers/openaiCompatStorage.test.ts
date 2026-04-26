// #169 phase A — storage layer for openai_compat config: load, save,
// and CRUD helpers for built-in preset config slots and custom
// preset entries. API keys live in the keychain; URL templates,
// extraHeaders, templateVars, and the custom-preset list live in
// the settings table.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { __setImpl as setKc } from "@/lib/tauri/keychain";
import {
  loadOpenAICompatConfig,
  saveOpenAICompatConfig,
  setBuiltinPresetConfig,
  upsertCustomPreset,
  removeCustomPreset,
  renameCustomPreset,
  apiKeySlotForPreset,
  getApiKeyForPreset,
  setApiKeyForPreset,
  removeApiKeyForPreset,
} from "@/lib/providers/openaiCompatStorage";

interface SqlRow {
  key: string;
  value: string;
}

let store: Map<string, string>;
let keychainStore: Map<string, string>;

function installInMemorySettings(): void {
  store = new Map();
  __setImpl({
    async execute(sql, params = []) {
      if (sql.includes("INSERT INTO settings")) {
        const [k, v] = params as [string, string];
        store.set(k, v);
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (sql.includes("DELETE FROM settings")) {
        const [k] = params as [string];
        store.delete(k);
        return { rowsAffected: 1, lastInsertId: null };
      }
      return { rowsAffected: 0, lastInsertId: null };
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes("SELECT value FROM settings")) {
        const [k] = params as [string];
        const v = store.get(k);
        return v === undefined ? [] : ([{ value: v } as unknown as T]);
      }
      return [];
    },
    async close() {},
  });
}

function installInMemoryKeychain(): void {
  keychainStore = new Map();
  setKc({
    get: async (k) => keychainStore.get(k) ?? null,
    set: async (k, v) => {
      keychainStore.set(k, v);
    },
    remove: async (k) => {
      keychainStore.delete(k);
    },
    list: async () => [...keychainStore.keys()],
  });
}

beforeEach(() => {
  installInMemorySettings();
  installInMemoryKeychain();
});
afterEach(() => __resetImpl());

describe("loadOpenAICompatConfig / saveOpenAICompatConfig", () => {
  it("returns an empty config when nothing is stored", async () => {
    const cfg = await loadOpenAICompatConfig();
    expect(cfg.builtins).toEqual({});
    expect(cfg.customs).toEqual([]);
  });

  it("round-trips a config through save / load", async () => {
    await saveOpenAICompatConfig({
      builtins: {
        openrouter: {
          templateVars: {},
          extraHeaders: { "HTTP-Referer": "https://mchat2.local" },
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
    const cfg = await loadOpenAICompatConfig();
    expect(cfg.builtins.openrouter?.extraHeaders["HTTP-Referer"]).toBe("https://mchat2.local");
    expect(cfg.customs[0]?.name).toBe("my-vllm");
  });
});

describe("setBuiltinPresetConfig", () => {
  it("merges into existing builtins without clobbering siblings", async () => {
    await setBuiltinPresetConfig("openrouter", { templateVars: {}, extraHeaders: { foo: "bar" } });
    await setBuiltinPresetConfig("infomaniak", {
      templateVars: { PRODUCT_ID: "p123" },
      extraHeaders: {},
    });
    const cfg = await loadOpenAICompatConfig();
    expect(cfg.builtins.openrouter?.extraHeaders["foo"]).toBe("bar");
    expect(cfg.builtins.infomaniak?.templateVars["PRODUCT_ID"]).toBe("p123");
  });
});

describe("upsertCustomPreset / removeCustomPreset / renameCustomPreset", () => {
  const sample = {
    name: "my-vllm",
    baseUrl: "http://localhost:8000/v1/chat/completions",
    extraHeaders: {},
    requiresKey: false,
    supportsUsageStream: true,
  } as const;

  it("upsert adds when name is new, replaces when name exists", async () => {
    await upsertCustomPreset(sample);
    await upsertCustomPreset({ ...sample, baseUrl: "http://localhost:8001/v1/chat/completions" });
    const cfg = await loadOpenAICompatConfig();
    expect(cfg.customs).toHaveLength(1);
    expect(cfg.customs[0]?.baseUrl).toBe("http://localhost:8001/v1/chat/completions");
  });

  it("removeCustomPreset drops the named entry and its API key", async () => {
    await upsertCustomPreset(sample);
    await setApiKeyForPreset({ kind: "custom", name: "my-vllm" }, "sk-xyz");
    await removeCustomPreset("my-vllm");
    const cfg = await loadOpenAICompatConfig();
    expect(cfg.customs).toEqual([]);
    expect(await getApiKeyForPreset({ kind: "custom", name: "my-vllm" })).toBeNull();
  });

  it("renameCustomPreset moves the entry and the keychain slot", async () => {
    await upsertCustomPreset(sample);
    await setApiKeyForPreset({ kind: "custom", name: "my-vllm" }, "sk-xyz");
    await renameCustomPreset("my-vllm", "new-name");
    const cfg = await loadOpenAICompatConfig();
    expect(cfg.customs[0]?.name).toBe("new-name");
    expect(await getApiKeyForPreset({ kind: "custom", name: "my-vllm" })).toBeNull();
    expect(await getApiKeyForPreset({ kind: "custom", name: "new-name" })).toBe("sk-xyz");
  });

  it("renameCustomPreset to an existing name fails (no clobber)", async () => {
    await upsertCustomPreset(sample);
    await upsertCustomPreset({ ...sample, name: "other" });
    await expect(renameCustomPreset("my-vllm", "other")).rejects.toThrow(/exists|in use/i);
  });
});

describe("apiKeySlotForPreset", () => {
  it("uses a deterministic slot per built-in preset", () => {
    expect(apiKeySlotForPreset({ kind: "builtin", id: "openrouter" })).toBe(
      "openai_compat.openrouter.apiKey",
    );
    expect(apiKeySlotForPreset({ kind: "builtin", id: "infomaniak" })).toBe(
      "openai_compat.infomaniak.apiKey",
    );
  });

  it("uses a deterministic slot per custom preset based on its name", () => {
    expect(apiKeySlotForPreset({ kind: "custom", name: "my-vllm" })).toBe(
      "openai_compat.custom.my-vllm.apiKey",
    );
  });

  it("set / get / remove API key round-trip", async () => {
    await setApiKeyForPreset({ kind: "builtin", id: "openrouter" }, "sk-or-test");
    expect(await getApiKeyForPreset({ kind: "builtin", id: "openrouter" })).toBe("sk-or-test");
    await removeApiKeyForPreset({ kind: "builtin", id: "openrouter" });
    expect(await getApiKeyForPreset({ kind: "builtin", id: "openrouter" })).toBeNull();
  });
});
