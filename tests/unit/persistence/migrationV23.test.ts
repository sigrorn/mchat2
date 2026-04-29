// Migration v23 — conversations.flow_mode (#223).
// Tracks whether a conversation is "in flow mode" — i.e. the flow's
// auto-sync of persona selection is active. Default 0 preserves
// today's behaviour for every existing conversation.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v23 — conversations.flow_mode", () => {
  it("is the 23rd migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(23);
  });

  it("adds a non-null flow_mode INTEGER column with default 0", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }>("PRAGMA table_info(conversations)");
    const col = cols.find((c) => c.name === "flow_mode");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("INTEGER");
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe("0");
  });

  it("backfills existing conversations with flow_mode = 0", async () => {
    handle = await createTestDb({ stopAt: 22 });
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c1', 't', 1, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await handle.runRemainingMigrations();
    const rows = await sql.select<{ flow_mode: number }>(
      "SELECT flow_mode FROM conversations WHERE id = 'c1'",
    );
    expect(rows[0]?.flow_mode).toBe(0);
  });
});
