// #200/#195: rewritten onto createTestDb so the persona repo's
// junction reads work in tests. The previous mock didn't model the
// persona_runs_after table, which made cycle detection unreliable
// after #195 switched runsAfter reads to the junction.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPersona,
  updatePersona,
  deletePersona,
  PersonaValidationError,
} from "@/lib/personas/service";
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

describe("createPersona", () => {
  it("creates a valid persona and slugifies the name", async () => {
    const p = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice!",
      currentMessageIndex: 0,
    });
    expect(p.nameSlug).toBe("alice");
  });

  it("rejects reserved names", async () => {
    await expect(
      createPersona({
        conversationId: "c_1",
        provider: "mock",
        name: "all",
        currentMessageIndex: 0,
      }),
    ).rejects.toBeInstanceOf(PersonaValidationError);
  });

  it("rejects duplicates in same conversation", async () => {
    await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alice",
      currentMessageIndex: 0,
    });
    await expect(
      createPersona({
        conversationId: "c_1",
        provider: "mock",
        name: "alice",
        currentMessageIndex: 0,
      }),
    ).rejects.toMatchObject({ code: "name_in_use" });
  });
});

describe("updatePersona", () => {
  it("detects cycles via runsAfter", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "B",
      currentMessageIndex: 0,
      runsAfter: [a.id],
    });
    await expect(updatePersona({ id: a.id, runsAfter: [b.id] })).rejects.toMatchObject({
      code: "cycle",
    });
  });

  it("rejects self-parent", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    await expect(updatePersona({ id: a.id, runsAfter: [a.id] })).rejects.toMatchObject({
      code: "cycle",
    });
  });
});

describe("deletePersona", () => {
  it("tombstones instead of hard-deleting", async () => {
    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    await deletePersona(a.id);
    // Creating a new persona with the same slug now succeeds because the
    // uniqueness rule only applies to active rows.
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "A",
      currentMessageIndex: 0,
    });
    expect(b.id).not.toBe(a.id);
  });
});
