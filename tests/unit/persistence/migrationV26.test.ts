// Migration v26 — messages.flow_dispatched (#231).
// Distinguishes a flow-dispatched user message from a regular
// multi-target send so the chat header can render
// '[N] user → conversation → @claudio @geppetto' rather than the
// ambiguous '@claudio @geppetto'. Default 0 preserves today's
// rendering for every existing row.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v26 — messages.flow_dispatched", () => {
  it("is the 26th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(26);
  });

  it("adds a non-null flow_dispatched INTEGER column with default 0", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(messages)");
    const col = cols.find((c) => c.name === "flow_dispatched");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("INTEGER");
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe("0");
  });

  it("backfills existing user messages with flow_dispatched = 0", async () => {
    handle = await createTestDb({ stopAt: 25 });
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired, flow_mode)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]', 0)`,
    );
    await sql.execute(
      `INSERT INTO messages
        (id, conversation_id, role, content, created_at, idx,
         display_mode, pinned, addressed_to, audience,
         error_transient, input_tokens, output_tokens, usage_estimated)
        VALUES ('m1', 'c1', 'user', 'hi', 1, 0,
         'lines', 0, '["p_alice"]', '[]', 0, 0, 0, 0)`,
    );
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ flow_dispatched: number }>(
      "SELECT flow_dispatched FROM messages WHERE id = 'm1'",
    );
    expect(rows[0]?.flow_dispatched).toBe(0);
  });
});
