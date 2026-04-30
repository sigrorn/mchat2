// Migration v24 — messages.confirmed_at (#229).
// Lets the user click a small checkbox on a notice row to mark it
// confirmed; the renderer hides confirmed notices. Mirrors the
// superseded_at pattern from v19 — nullable INTEGER timestamp, NULL
// for unconfirmed, ms-epoch when confirmed.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v24 — messages.confirmed_at", () => {
  it("is the 24th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(24);
  });

  it("adds a nullable confirmed_at INTEGER column", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(messages)");
    const col = cols.find((c) => c.name === "confirmed_at");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("INTEGER");
    // Nullable: notnull = 0, no default required.
    expect(col?.notnull).toBe(0);
  });

  it("backfills existing messages with confirmed_at = NULL", async () => {
    handle = await createTestDb({ stopAt: 23 });
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
        VALUES ('m1', 'c1', 'notice', 'hi', 1, 0,
         'lines', 0, '[]', '[]', 0, 0, 0, 0)`,
    );
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ confirmed_at: number | null }>(
      "SELECT confirmed_at FROM messages WHERE id = 'm1'",
    );
    expect(rows[0]?.confirmed_at).toBeNull();
  });
});
