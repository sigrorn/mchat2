// #158 — End-to-end migration test: every production migration must
// apply cleanly against a fresh in-memory sql.js DB. This is the
// forcing function for "schema drift between mock and prod is
// impossible" claim of #145.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;

afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("createTestDb runs all migrations", () => {
  it("ends at user_version === MIGRATIONS.length", async () => {
    handle = await createTestDb();
    const rows = await sql.select<{ user_version: number }>("PRAGMA user_version");
    expect(rows[0]?.user_version).toBe(MIGRATIONS.length);
  });

  it("creates the four expected tables", async () => {
    handle = await createTestDb();
    const tables = await sql.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);
    expect(names).toContain("conversations");
    expect(names).toContain("personas");
    expect(names).toContain("messages");
    expect(names).toContain("settings");
  });

  it("messages table has all the columns the latest schema expects", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(messages)");
    const names = cols.map((c) => c.name);
    // Spot-check columns added across multiple migrations:
    expect(names).toContain("id");
    expect(names).toContain("content");
    // v2 — token accounting
    expect(names).toContain("input_tokens");
    expect(names).toContain("output_tokens");
    expect(names).toContain("usage_estimated");
    // v3 — audience
    expect(names).toContain("audience");
    // v9 — streaming timings
    expect(names).toContain("ttft_ms");
    expect(names).toContain("stream_ms");
  });

  it("conversations table has all the columns added through v8", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(conversations)");
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("title");
    expect(names).toContain("system_prompt");
    expect(names).toContain("display_mode");
    expect(names).toContain("visibility_mode");
    expect(names).toContain("visibility_matrix");
    // #240: limit_size_tokens dropped along with //limitsize; replace
    // the assertion with selected_personas (added at v7) so this test
    // still proves migrations past v6 ran.
    expect(names).toContain("selected_personas");
    expect(names).toContain("compaction_floor_index");
    expect(names).toContain("autocompact_threshold");
    expect(names).toContain("context_warnings_fired");
  });

  it("INSERT + SELECT round-trip works after migrations", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
      ["c_1", "Hello", 1000],
    );
    const rows = await sql.select<{ id: string; title: string }>(
      "SELECT id, title FROM conversations",
    );
    expect(rows).toEqual([{ id: "c_1", title: "Hello" }]);
  });

  it("a second createTestDb() yields an empty DB (test isolation)", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
      ["c_1", "First", 1000],
    );
    handle.restore();
    handle = await createTestDb();
    const rows = await sql.select<{ id: string }>("SELECT id FROM conversations");
    expect(rows).toEqual([]);
  });
});
