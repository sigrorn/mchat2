// Migration v21 — flows + flow_steps + flow_step_personas + runs.flow_step_id.
// Slice 3 of #212 (#215). The data layer for conversation flows.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v21 — flow tables + runs.flow_step_id", () => {
  it("is the 21st migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(21);
  });

  it("creates the flows table with the expected columns", async () => {
    // Pin the v21 schema by stopping migrations at 21 — later
    // migrations (v22 added loop_start_index) shouldn't perturb what
    // this test asserts about v21's contribution.
    handle = await createTestDb({ stopAt: 21 });
    const cols = await sql.select<{ name: string; type: string; notnull: number }>(
      "PRAGMA table_info(flows)",
    );
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["conversation_id", "current_step_index", "id"]);
    const stepIdx = cols.find((c) => c.name === "current_step_index");
    expect(stepIdx?.type.toUpperCase()).toBe("INTEGER");
    expect(stepIdx?.notnull).toBe(1);
  });

  it("enforces conversation_id UNIQUE on flows", async () => {
    handle = await createTestDb();
    const idx = await sql.select<{ name: string; unique: number }>(
      "PRAGMA index_list(flows)",
    );
    expect(idx.some((i) => i.unique === 1)).toBe(true);
  });

  it("creates flow_steps with sequence + kind CHECK", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(flow_steps)");
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["flow_id", "id", "kind", "sequence"]);

    // Insert a flow + valid steps to confirm the CHECK accepts the
    // documented kinds.
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index)
        VALUES ('f1', 'c1', 0)`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind)
        VALUES ('s1', 'f1', 0, 'user'), ('s2', 'f1', 1, 'personas')`,
    );

    // CHECK rejects an unknown kind.
    await expect(
      sql.execute(
        `INSERT INTO flow_steps (id, flow_id, sequence, kind)
          VALUES ('s_bad', 'f1', 2, 'whatever')`,
      ),
    ).rejects.toThrow();
  });

  it("enforces UNIQUE(flow_id, sequence) on flow_steps", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index)
        VALUES ('f1', 'c1', 0)`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind)
        VALUES ('s1', 'f1', 0, 'user')`,
    );
    await expect(
      sql.execute(
        `INSERT INTO flow_steps (id, flow_id, sequence, kind)
          VALUES ('s2', 'f1', 0, 'personas')`,
      ),
    ).rejects.toThrow();
  });

  it("creates flow_step_personas with composite primary key", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>(
      "PRAGMA table_info(flow_step_personas)",
    );
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(["flow_step_id", "persona_id"]);
  });

  it("CASCADE-deletes the flow when its conversation is deleted", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index)
        VALUES ('f1', 'c1', 0)`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind)
        VALUES ('s1', 'f1', 0, 'user')`,
    );
    await sql.execute(`DELETE FROM conversations WHERE id = 'c1'`);
    const flows = await sql.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM flows",
    );
    const steps = await sql.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM flow_steps",
    );
    expect(flows[0]?.count).toBe(0);
    expect(steps[0]?.count).toBe(0);
  });

  it("adds nullable flow_step_id to runs", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string; type: string; notnull: number }>(
      "PRAGMA table_info(runs)",
    );
    const col = cols.find((c) => c.name === "flow_step_id");
    expect(col).toBeDefined();
    expect(col?.notnull).toBe(0);
  });

  it("FK SET NULL on runs.flow_step_id when flow_step deleted", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index)
        VALUES ('f1', 'c1', 0)`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind)
        VALUES ('s1', 'f1', 0, 'personas')`,
    );
    await sql.execute(
      `INSERT INTO runs (id, conversation_id, kind, started_at, completed_at, flow_step_id)
        VALUES ('r1', 'c1', 'send', 1, 1, 's1')`,
    );
    await sql.execute(`DELETE FROM flow_steps WHERE id = 's1'`);
    const r = await sql.select<{ flow_step_id: string | null }>(
      "SELECT flow_step_id FROM runs WHERE id = 'r1'",
    );
    expect(r[0]?.flow_step_id).toBeNull();
  });
});
