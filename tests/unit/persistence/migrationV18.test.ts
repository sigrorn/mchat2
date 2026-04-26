// Migration v18 — conversation_context_warnings table (#192 → #196).
// Replaces the JSON-encoded conversations.context_warnings_fired with
// a relational form that gains a fired_at timestamp. Legacy column
// stays populated as a dual-write rollback safety net.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v18 — conversation_context_warnings", () => {
  it("is the 18th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(18);
  });

  it("creates the table with composite PK and fired_at column", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>(
      "PRAGMA table_info(conversation_context_warnings)",
    );
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["conversation_id", "fired_at", "threshold"]);
  });

  it("backfills with fired_at = conversation.created_at", async () => {
    handle = await createTestDb({ stopAt: 17 });
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'A', 1234, 'lines', 'separated', '{}', '[]', '[80, 90]'),
              ('c_2', 'B', 5678, 'lines', 'separated', '{}', '[]', '[]'),
              ('c_3', 'C', 9999, 'lines', 'separated', '{}', '[]', '[98]')`,
    );
    await handle.runRemainingMigrations();

    const rows = await sql.select<{
      conversation_id: string;
      threshold: number;
      fired_at: number;
    }>(
      "SELECT conversation_id, threshold, fired_at FROM conversation_context_warnings ORDER BY conversation_id, threshold",
    );
    expect(rows).toEqual([
      { conversation_id: "c_1", threshold: 80, fired_at: 1234 },
      { conversation_id: "c_1", threshold: 90, fired_at: 1234 },
      { conversation_id: "c_3", threshold: 98, fired_at: 9999 },
    ]);
  });

  it("CASCADE: deleting a conversation drops its warning rows", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO conversation_context_warnings (conversation_id, threshold, fired_at)
       VALUES ('c_1', 80, 1)`,
    );
    await sql.execute(`DELETE FROM conversations WHERE id = 'c_1'`);
    const rows = await sql.select<{ conversation_id: string }>(
      "SELECT conversation_id FROM conversation_context_warnings",
    );
    expect(rows).toHaveLength(0);
  });
});
