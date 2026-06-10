// #200/#195: rewritten onto createTestDb so the persona repo's
// junction reads work in tests. The previous mock didn't model the
// persona_runs_after table, which made cycle detection unreliable
// after #195 switched runsAfter reads to the junction.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createPersona,
  deletePersona,
  PersonaValidationError,
} from "@/lib/personas/service";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 0, 'lines', 'separated', '[]', '[]')`,
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

// #241 Phase A: cycle and self-parent validation in updatePersona was
// removed alongside the persona-editor's runs_after field. The only
// remaining caller (auto-migration) clears runsAfter to [] which never
// trips the validator, so the tests are obsolete.

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

  // #280: prophylactic — deletePersona / tombstonePersona /
  // removeSlugFromSiblings used to ignore an optional dbi, so any
  // future caller that wraps a persona deletion in a transaction()
  // would deadlock (every internal queued call waits for the section
  // that holds the queue head). Pin that the function is safe to call
  // from inside a transaction body. The test will time out (and fail)
  // pre-fix because the queue waits forever.
  it("works when called from inside a transaction (no deadlock)", async () => {
    const { transaction } = await import("@/lib/persistence/transaction");

    const a = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alpha",
      currentMessageIndex: 0,
    });

    // Race the transaction against a 4s timeout so a deadlock surfaces
    // as a test failure instead of a 5s vitest hang.
    await Promise.race([
      transaction(async (txn) => {
        await deletePersona(a.id, txn.db);
      }),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "deletePersona inside transaction did not complete within 4s — deadlocked on the global op queue",
              ),
            ),
          4000,
        ),
      ),
    ]);

    // Tombstone landed: the slug is reusable.
    const b = await createPersona({
      conversationId: "c_1",
      provider: "mock",
      name: "Alpha",
      currentMessageIndex: 0,
    });
    expect(b.id).not.toBe(a.id);
  });
});
