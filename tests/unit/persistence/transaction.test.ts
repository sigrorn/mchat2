// #164 — Transactional unit-of-work helper. The repo-level functions
// already share a single `sql` singleton; this helper wraps a BEGIN /
// COMMIT around a caller-supplied lambda and ROLLBACKs on throw, so a
// failure mid-way through a multi-step mutation leaves the DB in its
// pre-call state.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql, __setImpl } from "@/lib/tauri/sql";
import { transaction } from "@/lib/persistence/transaction";

let handle: TestDbHandle | null = null;

afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedRow(): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations
       (id, title, created_at, display_mode, visibility_mode,
        visibility_matrix, selected_personas, context_warnings_fired)
     VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
    ["c_1", "Original", 1000],
  );
}

async function readTitle(): Promise<string | null> {
  const rows = await sql.select<{ title: string }>(
    "SELECT title FROM conversations WHERE id = ?",
    ["c_1"],
  );
  return rows[0]?.title ?? null;
}

describe("transaction()", () => {
  it("commits the inner mutations and returns fn's value", async () => {
    handle = await createTestDb();
    await seedRow();

    const ret = await transaction(async () => {
      await sql.execute("UPDATE conversations SET title = ? WHERE id = ?", [
        "Edited",
        "c_1",
      ]);
      return 42;
    });

    expect(ret).toBe(42);
    expect(await readTitle()).toBe("Edited");
  });

  it("rolls back every step when fn throws", async () => {
    handle = await createTestDb();
    await seedRow();

    await expect(
      transaction(async () => {
        await sql.execute("UPDATE conversations SET title = ? WHERE id = ?", [
          "Edited",
          "c_1",
        ]);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Title must be reverted to its pre-transaction value.
    expect(await readTitle()).toBe("Original");
  });

  it("rolls back even when the throw comes from a SQL execute", async () => {
    handle = await createTestDb();
    await seedRow();

    await expect(
      transaction(async () => {
        await sql.execute("UPDATE conversations SET title = ? WHERE id = ?", [
          "Edited",
          "c_1",
        ]);
        // Invalid SQL — sql.js raises which transaction must catch and
        // ROLLBACK before re-throwing.
        await sql.execute("INSERT INTO no_such_table (x) VALUES (1)");
      }),
    ).rejects.toBeDefined();

    expect(await readTitle()).toBe("Original");
  });

  it("rejects nested transaction() calls (no implicit savepoints)", async () => {
    handle = await createTestDb();
    await seedRow();

    await expect(
      transaction(async () => {
        await transaction(async () => {
          /* never reached */
        });
      }),
    ).rejects.toThrow(/nested|already in/i);
  });

  // #206: a stuck flag was crippling the running app — when BEGIN
  // IMMEDIATE itself threw (database is locked), the inTransaction
  // flag was set BEFORE the try, so finally never ran to reset it.
  // Every subsequent transaction() call then threw "nested" forever
  // until the app restarted.
  it("does not strand the inTransaction flag when BEGIN itself throws", async () => {
    handle = await createTestDb();
    await seedRow();

    // Swap the SQL impl with one that fails BEGIN once, then succeeds.
    const realImpl = handle.impl;
    let beginAttempts = 0;
    __setImpl({
      execute: async (q, p) => {
        if (/^\s*BEGIN/i.test(q)) {
          beginAttempts += 1;
          if (beginAttempts === 1) {
            throw new Error("database is locked");
          }
        }
        return realImpl.execute(q, p);
      },
      select: realImpl.select,
      close: realImpl.close,
    });

    // First attempt — BEGIN throws, the helper must propagate without
    // leaving inTransaction stuck on `true`.
    await expect(transaction(async () => 1)).rejects.toThrow(/database is locked/i);

    // Second attempt would have failed pre-#206 with the misleading
    // "nested call detected" instead of running. Now BEGIN succeeds
    // (second attempt) and the body runs cleanly.
    const ret = await transaction(async () => {
      await sql.execute("UPDATE conversations SET title = ? WHERE id = ?", [
        "Edited",
        "c_1",
      ]);
      return "ok";
    });
    expect(ret).toBe("ok");
    expect(await readTitle()).toBe("Edited");
  });
});
