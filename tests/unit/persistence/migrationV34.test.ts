// Migration v34 — drop conversations.visibility_matrix (#315).
//
// persona_visibility (relational, slug-keyed) has been the sole read
// source for the visibility matrix since #202; the JSON column was a
// dual-write rollback safety net whose window is long closed. This
// migration drops it. A row populated at v33 must survive the upgrade
// (other columns intact) with the column gone, and visibility must keep
// resolving from the relational table.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";
import {
  createConversation,
  getConversation,
  writeVisibilityMatrix,
} from "@/lib/persistence/conversations";
import { createPersona } from "@/lib/persistence/personas";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v34 — drop conversations.visibility_matrix (#315)", () => {
  it("is at least the 34th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(34);
  });

  it("drops the column but preserves the row's other data", async () => {
    handle = await createTestDb({ stopAt: 33 });
    // Seed a v33 conversation row WITH a populated visibility_matrix JSON
    // column (proving the column exists pre-migration and holds data).
    await sql.execute(
      `INSERT INTO conversations
        (id, title, created_at, display_mode, visibility_mode,
         visibility_matrix, selected_personas, context_warnings_fired,
         flow_mode, last_seen_at, last_message_at)
        VALUES ('c1', 'keep me', 1, 'lines', 'separated',
                '{"p_a":["p_b"]}', '[]', '[]', 0, 0, 0)`,
    );
    const before = await sql.select<{ name: string }>("PRAGMA table_info(conversations)");
    expect(before.some((c) => c.name === "visibility_matrix")).toBe(true);

    await handle.runRemainingMigrations();

    const after = await sql.select<{ name: string }>("PRAGMA table_info(conversations)");
    expect(after.some((c) => c.name === "visibility_matrix")).toBe(false);
    // Other data survives the table rewrite.
    const row = await sql.select<{ title: string }>(
      "SELECT title FROM conversations WHERE id = 'c1'",
    );
    expect(row[0]?.title).toBe("keep me");
  });

  it("visibility still resolves from persona_visibility after the drop", async () => {
    handle = await createTestDb();
    const conv = await createConversation({
      id: "c_vis",
      title: "t",
      systemPrompt: null,
      lastProvider: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    await createPersona({
      id: "p_a",
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      nameSlug: "alice",
      systemPromptOverride: null,
      modelOverride: null,
      colorOverride: null,
      createdAtMessageIndex: 0,
      sortOrder: 0,
      deletedAt: null,
      visibilityDefaults: {},
      openaiCompatPreset: null,
      roleLens: {},
    });
    await createPersona({
      id: "p_b",
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      nameSlug: "bob",
      systemPromptOverride: null,
      modelOverride: null,
      colorOverride: null,
      createdAtMessageIndex: 0,
      sortOrder: 1,
      deletedAt: null,
      visibilityDefaults: {},
      openaiCompatPreset: null,
      roleLens: {},
    });
    // p_a hides p_b: matrix[p_a] = [] (sees nobody else).
    await writeVisibilityMatrix(conv.id, { p_a: [] });
    const reloaded = await getConversation(conv.id);
    expect(reloaded?.visibilityMatrix["p_a"]).toEqual([]);
  });
});
