// Startup migration orchestration — issue #35.
import { describe, it, expect, vi } from "vitest";
import { runKeychainMigrationIfNeeded } from "@/lib/tauri/keychainStartup";
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

describe("runKeychainMigrationIfNeeded", () => {
  it("is a no-op when no legacy vault exists", async () => {
    const target = makeMem();
    const legacy = makeMem({ "anthropic_api_key": "should-not-be-read" });
    const renameSpy = vi.fn();
    const r = await runKeychainMigrationIfNeeded({
      hasLegacy: async () => false,
      legacy,
      target,
      knownKeys: ["anthropic_api_key"],
      renameVault: renameSpy,
    });
    expect(r.ran).toBe(false);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(target.store.size).toBe(0);
  });

  it("migrates keys and renames the vault when legacy is present", async () => {
    const target = makeMem();
    const legacy = makeMem({
      "anthropic_api_key": "a-key",
      "openai_api_key": "o-key",
    });
    const renameSpy = vi.fn();
    const r = await runKeychainMigrationIfNeeded({
      hasLegacy: async () => true,
      legacy,
      target,
      knownKeys: ["anthropic_api_key", "openai_api_key", "gemini_api_key"],
      renameVault: renameSpy,
    });
    expect(r.ran).toBe(true);
    expect(r.result?.copied).toEqual(["anthropic_api_key", "openai_api_key"]);
    expect(r.result?.missing).toEqual(["gemini_api_key"]);
    expect(target.store.get("anthropic_api_key")).toBe("a-key");
    expect(renameSpy).toHaveBeenCalledTimes(1);
  });

  it("still renames the vault even if every key was already present in target", async () => {
    const target = makeMem({ "anthropic_api_key": "already-there" });
    const legacy = makeMem({ "anthropic_api_key": "old-value" });
    const renameSpy = vi.fn();
    const r = await runKeychainMigrationIfNeeded({
      hasLegacy: async () => true,
      legacy,
      target,
      knownKeys: ["anthropic_api_key"],
      renameVault: renameSpy,
    });
    expect(r.ran).toBe(true);
    expect(r.result?.skipped).toEqual(["anthropic_api_key"]);
    expect(renameSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT rename the vault if any per-key error occurred (so user can retry)", async () => {
    const target = makeMem();
    const legacy: KeychainImpl = {
      async get(k) {
        if (k === "openai_api_key") throw new Error("boom");
        return k === "anthropic_api_key" ? "value" : null;
      },
      async set() {},
      async remove() {},
      async list() {
        return [];
      },
    };
    const renameSpy = vi.fn();
    const r = await runKeychainMigrationIfNeeded({
      hasLegacy: async () => true,
      legacy,
      target,
      knownKeys: ["anthropic_api_key", "openai_api_key"],
      renameVault: renameSpy,
    });
    expect(r.ran).toBe(true);
    expect(r.result?.errors).toHaveLength(1);
    expect(renameSpy).not.toHaveBeenCalled();
  });
});
