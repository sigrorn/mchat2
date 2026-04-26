// #65 — Persist persona selection across restarts.
// #200/#191: rewritten onto sql.js round-trips so the test isn't
// coupled to the SQL syntax emitted by the repo.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import * as convRepo from "@/lib/persistence/conversations";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("selectedPersonas persistence (#65)", () => {
  it("createConversation persists selectedPersonas (round-trips through DB)", async () => {
    handle = await createTestDb();
    const c = await convRepo.createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: ["p_abc", "p_def"],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    expect(c.selectedPersonas).toEqual(["p_abc", "p_def"]);
    const fetched = await convRepo.getConversation(c.id);
    expect(fetched?.selectedPersonas).toEqual(["p_abc", "p_def"]);
  });

  it("getConversation parses selectedPersonas JSON from DB row", async () => {
    handle = await createTestDb();
    // Direct insert with explicit selected_personas value.
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 10, 'lines', 'separated', '{}', '["p_abc","p_def"]', '[]')`,
    );
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual(["p_abc", "p_def"]);
  });

  it("getConversation defaults to [] when selected_personas is empty array", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 10, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual([]);
  });

  it("getConversation handles malformed JSON gracefully", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 10, 'lines', 'separated', '{}', 'not-json', '[]')`,
    );
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual([]);
  });

  it("updateConversation persists selectedPersonas changes (round-trips through DB)", async () => {
    handle = await createTestDb();
    const c = await convRepo.createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    await convRepo.updateConversation({ ...c, selectedPersonas: ["p_xyz"] });
    const after = await convRepo.getConversation(c.id);
    expect(after?.selectedPersonas).toEqual(["p_xyz"]);
  });
});
