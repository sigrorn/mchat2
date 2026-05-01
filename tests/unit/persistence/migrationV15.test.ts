// Migration v15 — conversation_personas_selected junction table
// (#192 → #193). Replaces the JSON-encoded
// conversations.selected_personas with a relational form. The old
// column stays for now (will be dropped in a future cleanup); reads
// happen through the junction.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v15 — selected_personas junction", () => {
  it("is the 15th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(15);
  });

  it("creates the conversation_personas_selected table with correct columns + indexes", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>(
      "PRAGMA table_info(conversation_personas_selected)",
    );
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["conversation_id", "persona_id"]);
    const indexes = await sql.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='conversation_personas_selected'",
    );
    expect(indexes.map((i) => i.name)).toContain("idx_conv_personas_selected_persona");
  });

  it("backfills the junction from existing selected_personas JSON arrays", async () => {
    handle = await createTestDb({ stopAt: 14 });
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'A', 1, 'lines', 'separated', '{}', '["p_a","p_b"]', '[]'),
              ('c_2', 'B', 2, 'lines', 'separated', '{}', '[]', '[]'),
              ('c_3', 'C', 3, 'lines', 'separated', '{}', '["p_a"]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{}'),
              ('p_b', 'c_1', 'mock', 'B', 'b', 0, 0, '[]', '{}'),
              ('p_a2', 'c_3', 'mock', 'A', 'a', 0, 0, '[]', '{}')`,
    );
    // Run remaining migrations (v15 +)
    await handle.runRemainingMigrations();

    const rows = await sql.select<{ conversation_id: string; persona_id: string }>(
      "SELECT conversation_id, persona_id FROM conversation_personas_selected ORDER BY conversation_id, persona_id",
    );
    expect(rows).toHaveLength(2);
    // c_1 has p_a and p_b; c_3 has p_a2 (different persona); c_3's
    // selected_personas references "p_a" which exists in c_1 — but
    // the FK constraint resolves only ids that match a real persona
    // row, and p_a is in c_1 (different conversation_id). The
    // backfill should preserve the original JSON ids verbatim, even
    // if the FK target lives in another conversation. (In practice
    // selected_personas only ever contains personas FROM the same
    // conversation, so this is moot — but tested defensively.)
    const ids = rows.filter((r) => r.conversation_id === "c_1").map((r) => r.persona_id);
    expect(ids.sort()).toEqual(["p_a", "p_b"]);
    // c_2 → 0 rows (empty selection); c_3 → 0 rows because "p_a"
    // doesn't exist in personas table for c_3 (its persona is p_a2).
    // Backfill must be defensive: skip ids that don't resolve to a
    // real personas row, otherwise the FK insert fails.
  });

  it("CASCADE: deleting a persona drops its junction rows", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, visibility_defaults)
       VALUES ('p_x', 'c_1', 'mock', 'X', 'x', 0, 0, '{}')`,
    );
    await sql.execute(
      `INSERT INTO conversation_personas_selected (conversation_id, persona_id) VALUES ('c_1', 'p_x')`,
    );
    await sql.execute(`DELETE FROM personas WHERE id = 'p_x'`);
    const rows = await sql.select<{ persona_id: string }>(
      "SELECT persona_id FROM conversation_personas_selected WHERE conversation_id = 'c_1'",
    );
    expect(rows).toHaveLength(0);
  });

  it("CASCADE: deleting a conversation drops its junction rows", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, visibility_defaults)
       VALUES ('p_x', 'c_1', 'mock', 'X', 'x', 0, 0, '{}')`,
    );
    await sql.execute(
      `INSERT INTO conversation_personas_selected (conversation_id, persona_id) VALUES ('c_1', 'p_x')`,
    );
    await sql.execute(`DELETE FROM conversations WHERE id = 'c_1'`);
    const rows = await sql.select<{ conversation_id: string }>(
      "SELECT conversation_id FROM conversation_personas_selected",
    );
    expect(rows).toHaveLength(0);
  });
});
