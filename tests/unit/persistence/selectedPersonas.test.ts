// #65 — Persist persona selection across restarts.
// #193: selectedPersonas now lives in the
// conversation_personas_selected junction table; the test seeds
// real personas (FK requirement) and round-trips through the repo.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import * as convRepo from "@/lib/persistence/conversations";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedPersonas(conversationId: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, visibility_defaults)
       VALUES (?, ?, 'mock', ?, ?, 0, 0, '{}')`,
      [id, conversationId, id, id],
    );
  }
}

describe("selectedPersonas persistence (#65)", () => {
  it("createConversation persists selectedPersonas through the junction", async () => {
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
    await seedPersonas(c.id, ["p_abc", "p_def"]);
    await convRepo.updateConversation({ ...c, selectedPersonas: ["p_abc", "p_def"] });
    const fetched = await convRepo.getConversation(c.id);
    expect(fetched?.selectedPersonas?.sort()).toEqual(["p_abc", "p_def"]);
  });

  it("getConversation reads selectedPersonas from the junction", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 10, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await seedPersonas("c_1", ["p_abc", "p_def"]);
    await sql.execute(
      `INSERT INTO conversation_personas_selected (conversation_id, persona_id) VALUES
         ('c_1', 'p_abc'), ('c_1', 'p_def')`,
    );
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas?.sort()).toEqual(["p_abc", "p_def"]);
  });

  it("getConversation returns [] when no junction rows exist", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 10, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual([]);
  });

  it("updateConversation replaces junction rows on selectedPersonas change", async () => {
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
    await seedPersonas(c.id, ["p_xyz", "p_old"]);
    await convRepo.updateConversation({ ...c, selectedPersonas: ["p_old"] });
    let after = await convRepo.getConversation(c.id);
    expect(after?.selectedPersonas).toEqual(["p_old"]);
    await convRepo.updateConversation({ ...c, selectedPersonas: ["p_xyz"] });
    after = await convRepo.getConversation(c.id);
    expect(after?.selectedPersonas).toEqual(["p_xyz"]);
  });
});
