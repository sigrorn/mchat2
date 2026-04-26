// #164 — Transactional unit-of-work helper. The repo-level functions
// already share a single `sql` singleton; this helper wraps a BEGIN /
// COMMIT around a caller-supplied lambda and ROLLBACKs on throw, so a
// failure mid-way through a multi-step mutation leaves the DB in its
// pre-call state.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
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
});
