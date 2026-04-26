// Migration v17 — persona_runs_after edge table (#192 → #195).
// Replaces the JSON-encoded personas.runs_after column with a
// relational edge table. Legacy column stays populated as a
// dual-write rollback safety net; read path switches in the same PR.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v17 — persona_runs_after edge table", () => {
  it("is the 17th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(17);
  });

  it("creates persona_runs_after with composite PK + reverse-lookup index", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(persona_runs_after)");
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["child_id", "parent_id"]);
    const indexes = await sql.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='persona_runs_after'",
    );
    expect(indexes.map((i) => i.name)).toContain("idx_persona_runs_after_parent");
  });

  it("backfills edges from existing runs_after JSON arrays", async () => {
    handle = await createTestDb({ stopAt: 16 });
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{}'),
              ('p_b', 'c_1', 'mock', 'B', 'b', 1, 1, '["p_a"]', '{}'),
              ('p_c', 'c_1', 'mock', 'C', 'c', 2, 2, '["p_a","p_b"]', '{}')`,
    );
    await handle.runRemainingMigrations();

    const rows = await sql.select<{ child_id: string; parent_id: string }>(
      "SELECT child_id, parent_id FROM persona_runs_after ORDER BY child_id, parent_id",
    );
    expect(rows).toEqual([
      { child_id: "p_b", parent_id: "p_a" },
      { child_id: "p_c", parent_id: "p_a" },
      { child_id: "p_c", parent_id: "p_b" },
    ]);
  });

  it("CASCADE: deleting a child persona drops its outgoing edges", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{}'),
              ('p_b', 'c_1', 'mock', 'B', 'b', 1, 1, '[]', '{}')`,
    );
    await sql.execute(
      `INSERT INTO persona_runs_after (child_id, parent_id) VALUES ('p_b', 'p_a')`,
    );
    await sql.execute(`DELETE FROM personas WHERE id = 'p_b'`);
    const rows = await sql.select<{ child_id: string }>("SELECT child_id FROM persona_runs_after");
    expect(rows).toHaveLength(0);
  });

  it("CASCADE: deleting a parent persona drops incoming edges", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{}'),
              ('p_b', 'c_1', 'mock', 'B', 'b', 1, 1, '[]', '{}')`,
    );
    await sql.execute(
      `INSERT INTO persona_runs_after (child_id, parent_id) VALUES ('p_b', 'p_a')`,
    );
    await sql.execute(`DELETE FROM personas WHERE id = 'p_a'`);
    const rows = await sql.select<{ parent_id: string }>(
      "SELECT parent_id FROM persona_runs_after",
    );
    expect(rows).toHaveLength(0);
  });
});
