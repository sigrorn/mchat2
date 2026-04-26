// Migration v16 — persona_visibility relational table (#192 → #194).
// Replaces conversations.visibility_matrix + personas.visibility_defaults
// JSON columns. The legacy columns stay populated for the dual-write
// rollback safety; the read path's switch to this table is deferred to
// a follow-up issue (the rewrite of buildMatrixFromDefaults touches
// service code, the //visibility command, and the matrix UI panel).
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v16 — persona_visibility table", () => {
  it("is the 16th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(16);
  });

  it("creates the persona_visibility table with the right columns", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(persona_visibility)");
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["conversation_id", "observer_slug", "source_slug", "visible"]);
  });

  it("backfills from visibility_matrix JSON (observer→sources mapping)", async () => {
    handle = await createTestDb({ stopAt: 15 });
    // Seed a conversation whose visibility_matrix references persona ids;
    // backfill needs to translate ids → slugs via the personas table.
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{"p_a":["p_b","p_c"]}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{}'),
              ('p_b', 'c_1', 'mock', 'B', 'b', 0, 0, '[]', '{}'),
              ('p_c', 'c_1', 'mock', 'C', 'c', 0, 0, '[]', '{}')`,
    );
    await handle.runRemainingMigrations();

    const rows = await sql.select<{
      conversation_id: string;
      observer_slug: string;
      source_slug: string;
      visible: number;
    }>(
      "SELECT conversation_id, observer_slug, source_slug, visible FROM persona_visibility ORDER BY observer_slug, source_slug",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      conversation_id: "c_1",
      observer_slug: "a",
      source_slug: "b",
      visible: 1,
    });
    expect(rows[1]).toEqual({
      conversation_id: "c_1",
      observer_slug: "a",
      source_slug: "c",
      visible: 1,
    });
  });

  it("backfills from visibility_defaults JSON ('n' entries → visible=0)", async () => {
    handle = await createTestDb({ stopAt: 15 });
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{"b":"n","c":"y"}')`,
    );
    await handle.runRemainingMigrations();

    const rows = await sql.select<{
      observer_slug: string;
      source_slug: string;
      visible: number;
    }>(
      "SELECT observer_slug, source_slug, visible FROM persona_visibility ORDER BY source_slug",
    );
    // visibilityDefaults is the persona's view of who they can see;
    // the persona is the observer here. 'b' → 'n' becomes visible=0;
    // 'c' → 'y' becomes visible=1.
    expect(rows).toEqual([
      { observer_slug: "a", source_slug: "b", visible: 0 },
      { observer_slug: "a", source_slug: "c", visible: 1 },
    ]);
  });

  it("matrix entries override defaults (defaults backfilled first, then matrix on top)", async () => {
    handle = await createTestDb({ stopAt: 15 });
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 1, 'lines', 'separated', '{"p_a":["p_b"]}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES ('p_a', 'c_1', 'mock', 'A', 'a', 0, 0, '[]', '{"b":"n"}'),
              ('p_b', 'c_1', 'mock', 'B', 'b', 0, 0, '[]', '{}')`,
    );
    await handle.runRemainingMigrations();

    const row = await sql.select<{ visible: number }>(
      "SELECT visible FROM persona_visibility WHERE observer_slug = 'a' AND source_slug = 'b'",
    );
    // Default says 0; matrix says 1; matrix wins.
    expect(row[0]?.visible).toBe(1);
  });
});
