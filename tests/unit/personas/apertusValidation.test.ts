// Apertus persona creation no longer requires a per-persona product
// id — it lives in global settings now (#25).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { createPersona } from "@/lib/personas/service";

beforeEach(() => {
  __setImpl({
    async execute() {
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(): Promise<T[]> {
      return [];
    },
    async close() {},
  });
});
afterEach(() => __resetImpl());

describe("createPersona apertus (#25)", () => {
  it("accepts an apertus persona without a productId — global setting handles it", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "apertus",
      name: "Swissy",
      currentMessageIndex: 0,
    });
    expect(p.provider).toBe("apertus");
  });

  it("non-apertus personas are unaffected", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Mocky",
      currentMessageIndex: 0,
    });
    expect(p.provider).toBe("mock");
  });
});
