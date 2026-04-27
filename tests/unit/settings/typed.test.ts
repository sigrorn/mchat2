import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { getSetting, setSetting } from "@/lib/persistence/settings";
import { defineNumberSetting } from "@/lib/settings/typed";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("defineNumberSetting", () => {
  it("returns the default when the key is missing", async () => {
    handle = await createTestDb();
    const s = defineNumberSetting("test.key", { default: 50000, min: 1 });
    expect(await s.get()).toBe(50000);
  });

  it("returns the default when the stored value is blank", async () => {
    handle = await createTestDb();
    await setSetting("test.key", "");
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    expect(await s.get()).toBe(42);
  });

  it("returns the default when the stored value is not an integer", async () => {
    handle = await createTestDb();
    await setSetting("test.key", "nope");
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    expect(await s.get()).toBe(42);
  });

  it("returns the default when the stored value is below min", async () => {
    handle = await createTestDb();
    await setSetting("test.key", "0");
    const s = defineNumberSetting("test.key", { default: 5, min: 1 });
    expect(await s.get()).toBe(5);
  });

  it("returns a stored valid integer value", async () => {
    handle = await createTestDb();
    await setSetting("test.key", "123");
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    expect(await s.get()).toBe(123);
  });

  it("stores via set() as a string", async () => {
    handle = await createTestDb();
    const s = defineNumberSetting("test.key", { default: 42, min: 1 });
    await s.set(777);
    expect(await getSetting("test.key")).toBe("777");
  });

  it("set() rejects values below min", async () => {
    handle = await createTestDb();
    const s = defineNumberSetting("test.key", { default: 5, min: 1 });
    await expect(s.set(0)).rejects.toThrow();
  });

  it("set() rejects non-integer numbers", async () => {
    handle = await createTestDb();
    const s = defineNumberSetting("test.key", { default: 5, min: 1 });
    await expect(s.set(1.5)).rejects.toThrow();
  });
});
