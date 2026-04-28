// Migration v20 — personas.role_lens column (#213, slice 1 of #212).
// JSON map { speakerKey -> "user" | "assistant" }. speakerKey is either
// a persona-id or the literal "user". Default '{}' = no overrides,
// preserves today's role-mapping behavior bit-for-bit.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v20 — personas.role_lens", () => {
  it("is the 20th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(20);
  });

  it("adds a non-null role_lens TEXT column with default '{}'", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(personas)");
    const col = cols.find((c) => c.name === "role_lens");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("TEXT");
    expect(col?.notnull).toBe(1);
    // Default literal is wrapped in single quotes by SQLite when stored.
    expect(col?.dflt_value).toMatch(/^'?\{\}'?$/);
  });

  it("defaults role_lens to '{}' on existing rows after migration", async () => {
    // Seed a conversation + persona at v19 then run v20.
    handle = await createTestDb({ stopAt: 19 });
    await sql.execute(
      `INSERT INTO conversations
         (id, title, created_at, display_mode, visibility_mode,
          visibility_matrix, selected_personas, context_warnings_fired)
       VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
      ["c1", "t", 1000],
    );
    await sql.execute(
      `INSERT INTO personas
         (id, conversation_id, provider, name, name_slug,
          created_at_message_index, sort_order, runs_after,
          visibility_defaults)
       VALUES (?, ?, 'mock', 'Alice', 'alice', 0, 0, '[]', '{}')`,
      ["p1", "c1"],
    );
    // Apply migration 20 by re-running migrations to current target.
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ role_lens: string }>(
      "SELECT role_lens FROM personas WHERE id = ?",
      ["p1"],
    );
    expect(rows[0]?.role_lens).toBe("{}");
  });
});
