// Migration v25 — flow_steps.instruction (#230).
// Optional per-step hidden instruction injected into the system prompt
// of every persona dispatched at this step. Nullable TEXT — NULL means
// no extra instruction (default for every existing step).
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v25 — flow_steps.instruction", () => {
  it("is the 25th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(25);
  });

  it("adds a nullable instruction TEXT column", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(flow_steps)");
    const col = cols.find((c) => c.name === "instruction");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("TEXT");
    expect(col?.notnull).toBe(0);
  });

  it("backfills existing flow steps with instruction = NULL", async () => {
    handle = await createTestDb({ stopAt: 24 });
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired, flow_mode)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]', 0)`,
    );
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index, loop_start_index)
       VALUES ('f1', 'c1', 0, 0)`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind)
       VALUES ('s1', 'f1', 0, 'user')`,
    );
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ instruction: string | null }>(
      "SELECT instruction FROM flow_steps WHERE id = 's1'",
    );
    expect(rows[0]?.instruction).toBeNull();
  });
});
