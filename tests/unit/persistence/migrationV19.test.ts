// Migration v19 — messages.superseded_at column (#206 follow-up).
// The attempt-id-keyed superseded mechanism from #180 only worked
// for pre-#179 / post-#205 attempts. A message-level marker makes
// hide-on-replay / hide-on-retry work for all data, regardless of
// the attempt-id format underneath.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v19 — messages.superseded_at", () => {
  it("is the 19th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(19);
  });

  it("adds a nullable superseded_at column to messages", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string; type: string; notnull: number }>(
      "PRAGMA table_info(messages)",
    );
    const col = cols.find((c) => c.name === "superseded_at");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("INTEGER");
    // Existing messages keep superseded_at = NULL (visible by default).
    expect(col?.notnull).toBe(0);
  });

  it("defaults superseded_at to NULL for newly inserted rows", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations
         (id, title, created_at, display_mode, visibility_mode,
          visibility_matrix, selected_personas, context_warnings_fired)
       VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
      ["c1", "t", 1000],
    );
    await sql.execute(
      `INSERT INTO messages
         (id, conversation_id, role, content, display_mode, pinned,
          addressed_to, created_at, idx, error_transient,
          input_tokens, output_tokens, usage_estimated, audience)
       VALUES (?, ?, 'user', 'hi', 'lines', 0, '[]', ?, 0, 0, 0, 0, 0, '[]')`,
      ["m1", "c1", 1001],
    );
    const rows = await sql.select<{ superseded_at: number | null }>(
      "SELECT superseded_at FROM messages WHERE id = ?",
      ["m1"],
    );
    expect(rows[0]?.superseded_at).toBeNull();
  });
});
