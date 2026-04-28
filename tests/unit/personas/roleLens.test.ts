// Persona roleLens round-trip — slice 1 of #212 (#213).
// roleLens is a per-persona JSON map { speakerKey -> "user" | "assistant" }
// where speakerKey is either a persona-id or the literal "user".
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPersona,
  updatePersona,
} from "@/lib/personas/service";
import { getPersona, listPersonas } from "@/lib/persistence/personas";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
  );
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("persona.roleLens", () => {
  it("defaults to an empty map on create", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    expect(p.roleLens).toEqual({});
    const reread = await getPersona(p.id);
    expect(reread?.roleLens).toEqual({});
  });

  it("persists a role lens passed at create time", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
      roleLens: { user: "user", p_other: "user" },
    });
    expect(p.roleLens).toEqual({ user: "user", p_other: "user" });
    const reread = await getPersona(p.id);
    expect(reread?.roleLens).toEqual({ user: "user", p_other: "user" });
  });

  it("updates the role lens via updatePersona", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    await updatePersona({ id: p.id, roleLens: { p_bob: "user" } });
    const reread = await getPersona(p.id);
    expect(reread?.roleLens).toEqual({ p_bob: "user" });
  });

  it("preserves an existing lens when an unrelated field is updated", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
      roleLens: { user: "user" },
    });
    await updatePersona({ id: p.id, name: "Alicia" });
    const reread = await getPersona(p.id);
    expect(reread?.roleLens).toEqual({ user: "user" });
  });

  it("listPersonas returns role lens for every row", async () => {
    await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
      roleLens: { user: "user" },
    });
    await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Bob",
      currentMessageIndex: 0,
    });
    const all = await listPersonas("c_1");
    const alice = all.find((p) => p.name === "Alice")!;
    const bob = all.find((p) => p.name === "Bob")!;
    expect(alice.roleLens).toEqual({ user: "user" });
    expect(bob.roleLens).toEqual({});
  });

  it("rejects values that aren't 'user' or 'assistant'", async () => {
    // Defensive: only the two enum values are valid. The persona repo
    // is the trust boundary for legacy / corrupted JSON, so a malformed
    // entry is silently dropped rather than thrown.
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    await sql.execute(
      `UPDATE personas SET role_lens = ? WHERE id = ?`,
      [JSON.stringify({ user: "user", bogus: "system", p_x: "weird" }), p.id],
    );
    const reread = await getPersona(p.id);
    expect(reread?.roleLens).toEqual({ user: "user" });
  });
});
