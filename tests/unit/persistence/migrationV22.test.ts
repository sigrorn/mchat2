// Migration v22 — flows.loop_start_index column (#220).
// Allows flows to wrap back to a non-zero step at end of cycle so
// the leading steps function as a one-shot setup phase.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v22 — flows.loop_start_index", () => {
  it("is the 22nd migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(22);
  });

  it("adds a non-null loop_start_index INTEGER column with default 0", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(flows)");
    const col = cols.find((c) => c.name === "loop_start_index");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("INTEGER");
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe("0");
  });

  it("backfills existing flow rows with loop_start_index = 0", async () => {
    // Seed a flow at v21, then run v22.
    handle = await createTestDb({ stopAt: 21 });
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index)
        VALUES ('f1', 'c1', 2)`,
    );
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ loop_start_index: number; current_step_index: number }>(
      "SELECT loop_start_index, current_step_index FROM flows WHERE id = 'f1'",
    );
    expect(rows[0]?.loop_start_index).toBe(0);
    expect(rows[0]?.current_step_index).toBe(2);
  });
});
