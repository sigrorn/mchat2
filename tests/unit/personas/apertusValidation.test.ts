// Persona service rejects apertus persona without product id — issue #15.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { createPersona, PersonaValidationError } from "@/lib/personas/service";

beforeEach(() => {
  // Fresh in-memory recorder; service-internal listPersonas returns [].
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

describe("createPersona apertus validation", () => {
  it("rejects creating an apertus persona without apertusProductId", async () => {
    await expect(
      createPersona({
        conversationId: "c_1",
        provider: "apertus",
        name: "Swissy",
        currentMessageIndex: 0,
      }),
    ).rejects.toBeInstanceOf(PersonaValidationError);
  });

  it("accepts apertus persona with apertusProductId set", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "apertus",
      name: "Swissy",
      currentMessageIndex: 0,
      apertusProductId: "12345",
    });
    expect(p.apertusProductId).toBe("12345");
  });

  it("non-apertus personas are unaffected", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Mocky",
      currentMessageIndex: 0,
    });
    expect(p.apertusProductId).toBeNull();
  });
});
