// Migration v33 — messages.hidden_by_reset_id (#294).
//
// New nullable INTEGER column on messages. Non-null = the row is
// hidden from display + skipped by the context builder; rows still
// participate in cost/spend rollups so the user's USD totals are
// preserved across //reset operations. The integer doubles as a
// per-event group id so a future export (see docs/ideas.md) can
// color-code rows hidden by distinct reset boundaries.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v33 — messages.hidden_by_reset_id (#294)", () => {
  it("is at least the 33rd migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(33);
  });

  it("adds a nullable hidden_by_reset_id INTEGER column", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(messages)");
    const col = cols.find((c) => c.name === "hidden_by_reset_id");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toContain("INT");
    expect(col?.notnull).toBe(0);
  });

  it("backfills existing rows to NULL (every row visible after upgrade)", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired,
         flow_mode, last_seen_at, last_message_at)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]', 0, 0, 0)`,
    );
    await sql.execute(
      `INSERT INTO messages
        (id, conversation_id, role, content, provider, model,
         created_at, idx, display_mode, pinned, addressed_to, audience,
         error_transient, input_tokens, output_tokens, usage_estimated,
         flow_dispatched)
        VALUES ('m1', 'c1', 'user', 'hi', NULL, NULL,
                1, 0, 'lines', 0, '[]', '[]', 0, 0, 0, 0, 0)`,
    );
    const rows = await sql.select<{ hidden_by_reset_id: number | null }>(
      "SELECT hidden_by_reset_id FROM messages WHERE id = 'm1'",
    );
    expect(rows[0]?.hidden_by_reset_id).toBeNull();
  });
});
