// Keychain busy counter for the Composer 'Unlocking...' hint — #32.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { keychain, __setImpl, __resetImpl } from "@/lib/tauri/keychain";
import { useUiStore } from "@/stores/uiStore";

beforeEach(() => {
  useUiStore.setState({ keychainBusy: 0 });
});
afterEach(() => __resetImpl());

describe("keychain busy counter", () => {
  it("increments while get() is in flight and decrements on settle", async () => {
    let resolveGet!: (v: string | null) => void;
    __setImpl({
      get() {
        return new Promise<string | null>((r) => {
          resolveGet = r;
        });
      },
      async set() {},
      async remove() {},
      async list() {
        return [];
      },
    });
    const p = keychain.get("k");
    // Microtask: busy should have ticked up before the promise settles.
    await Promise.resolve();
    expect(useUiStore.getState().keychainBusy).toBe(1);
    resolveGet(null);
    await p;
    expect(useUiStore.getState().keychainBusy).toBe(0);
  });

  it("tracks concurrent calls with separate increments", async () => {
    const resolvers: Array<(v: string | null) => void> = [];
    __setImpl({
      get() {
        return new Promise<string | null>((r) => resolvers.push(r));
      },
      async set() {},
      async remove() {},
      async list() {
        return [];
      },
    });
    const p1 = keychain.get("a");
    const p2 = keychain.get("b");
    await Promise.resolve();
    expect(useUiStore.getState().keychainBusy).toBe(2);
    resolvers[0]?.(null);
    await p1;
    expect(useUiStore.getState().keychainBusy).toBe(1);
    resolvers[1]?.(null);
    await p2;
    expect(useUiStore.getState().keychainBusy).toBe(0);
  });

  it("decrements even when the impl rejects", async () => {
    __setImpl({
      async get() {
        throw new Error("nope");
      },
      async set() {},
      async remove() {},
      async list() {
        return [];
      },
    });
    await expect(keychain.get("k")).rejects.toThrow("nope");
    expect(useUiStore.getState().keychainBusy).toBe(0);
  });
});
