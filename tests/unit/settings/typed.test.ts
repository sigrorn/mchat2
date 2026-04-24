import { describe, it, expect, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { defineNumberSetting } from "@/lib/settings/typed";

function makeMockSettings() {
  const store = new Map<string, string>();
  __setImpl({
    async execute(q, args) {
      const params = args as unknown[] | undefined;
      if (/DELETE FROM settings/i.test(q)) {
        store.delete(String(params?.[0]));
      } else if (/INSERT INTO settings/i.test(q)) {
        store.set(String(params?.[0]), String(params?.[1]));
      }
      return { rowsAffected: 0, lastInsertId: null };
    },
    async select<T>(q: string, args?: unknown[]): Promise<T[]> {
      if (/SELECT value FROM settings/i.test(q)) {
        const key = String(args?.[0]);
        const v = store.get(key);
        return v === undefined ? [] : ([{ value: v } as unknown as T]);
      }
      return [];
    },
    async close() {},
  });
  return { store };
}

describe("defineNumberSetting", () => {
  afterEach(() => __resetImpl());

  it("returns the default when the key is missing", async () => {
    makeMockSettings();
    const s = defineNumberSetting("test.key", { default: 50000, min: 1 });
    expect(await s.get()).toBe(50000);
  });

  it("returns the default when the stored value is blank", async () => {
    const { store } = makeMockSettings();
    store.set("test.key", "");
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    expect(await s.get()).toBe(42);
  });

  it("returns the default when the stored value is not an integer", async () => {
    const { store } = makeMockSettings();
    store.set("test.key", "nope");
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    expect(await s.get()).toBe(42);
  });

  it("returns the default when the stored value is below min", async () => {
    const { store } = makeMockSettings();
    store.set("test.key", "0");
    const s = defineNumberSetting("test.key", { default: 5, min: 1 });
    expect(await s.get()).toBe(5);
  });

  it("returns a stored valid integer value", async () => {
    const { store } = makeMockSettings();
    store.set("test.key", "123");
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    expect(await s.get()).toBe(123);
  });

  it("stores via set() as a string", async () => {
    const { store } = makeMockSettings();
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    await s.set(777);
    expect(store.get("test.key")).toBe("777");
  });

  it("set() rejects values below min", async () => {
    makeMockSettings();
    const s = defineNumberSetting("test.key", { default: 5, min: 1 });
    await expect(s.set(0)).rejects.toThrow();
  });

  it("set() rejects non-integer numbers", async () => {
    makeMockSettings();
    const s = defineNumberSetting("test.key", { default: 5, min: 1 });
    await expect(s.set(1.5)).rejects.toThrow();
  });
});
