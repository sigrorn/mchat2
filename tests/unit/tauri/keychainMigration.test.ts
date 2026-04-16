// One-off Stronghold -> OS-keychain migration helper — issue #35.
import { describe, it, expect } from "vitest";
import { migrateKeychain } from "@/lib/tauri/keychainMigration";
import type { KeychainImpl } from "@/lib/tauri/keychain";

function makeMem(seed: Record<string, string> = {}): KeychainImpl & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async set(k, v) {
      store.set(k, v);
    },
    async remove(k) {
      store.delete(k);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

describe("migrateKeychain", () => {
  it("copies every known key from legacy to target when target is empty", async () => {
    const legacy = makeMem({ "anthropic.apiKey": "a-key", "openai.apiKey": "o-key" });
    const target = makeMem();
    const r = await migrateKeychain({
      legacy,
      target,
      knownKeys: ["anthropic.apiKey", "openai.apiKey", "gemini.apiKey"],
    });
    expect(r.copied).toEqual(["anthropic.apiKey", "openai.apiKey"]);
    expect(r.missing).toEqual(["gemini.apiKey"]);
    expect(target.store.get("anthropic.apiKey")).toBe("a-key");
    expect(target.store.get("openai.apiKey")).toBe("o-key");
  });

  it("skips keys already present in target (idempotent re-run)", async () => {
    const legacy = makeMem({ "anthropic.apiKey": "legacy-value" });
    const target = makeMem({ "anthropic.apiKey": "target-already-set" });
    const r = await migrateKeychain({
      legacy,
      target,
      knownKeys: ["anthropic.apiKey"],
    });
    expect(r.copied).toEqual([]);
    expect(r.skipped).toEqual(["anthropic.apiKey"]);
    expect(target.store.get("anthropic.apiKey")).toBe("target-already-set");
  });

  it("records errors per-key instead of aborting the whole run", async () => {
    const legacy: KeychainImpl = {
      async get(k) {
        if (k === "openai.apiKey") throw new Error("boom");
        return k === "anthropic.apiKey" ? "ok-value" : null;
      },
      async set() {},
      async remove() {},
      async list() {
        return [];
      },
    };
    const target = makeMem();
    const r = await migrateKeychain({
      legacy,
      target,
      knownKeys: ["anthropic.apiKey", "openai.apiKey"],
    });
    expect(r.copied).toEqual(["anthropic.apiKey"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.key).toBe("openai.apiKey");
    expect(r.errors[0]?.message).toContain("boom");
  });

  it("returns empty result when legacy has nothing to offer", async () => {
    const legacy = makeMem();
    const target = makeMem();
    const r = await migrateKeychain({
      legacy,
      target,
      knownKeys: ["anthropic.apiKey", "openai.apiKey"],
    });
    expect(r.copied).toEqual([]);
    expect(r.missing).toEqual(["anthropic.apiKey", "openai.apiKey"]);
    expect(r.errors).toEqual([]);
  });
});
