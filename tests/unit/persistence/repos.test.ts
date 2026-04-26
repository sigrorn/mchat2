// #200: round-trip tests through a real sql.js DB instead of
// SQL-string mocks. The previous version of this file matched on
// substrings ("MAX(idx)", "INSERT INTO conversations") and parameter
// positions, which gates Kysely-style query-builder migrations on
// rewriting every test. After this rewrite the same behavioral
// assertions hold no matter what SQL the repos emit.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import * as convRepo from "@/lib/persistence/conversations";
import * as personasRepo from "@/lib/persistence/personas";
import * as msgRepo from "@/lib/persistence/messages";
import * as settingsRepo from "@/lib/persistence/settings";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversation(id = "c_1"): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES (?, 'T', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
    [id],
  );
}

describe("conversationsRepo", () => {
  it("createConversation persists with generated id and timestamp", async () => {
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
    expect(c.id).toMatch(/^c_/);
    expect(c.createdAt).toBeGreaterThan(0);
    const fetched = await convRepo.getConversation(c.id);
    expect(fetched?.id).toBe(c.id);
    expect(fetched?.title).toBe("T");
  });

  it("getConversation maps row columns onto the domain shape", async () => {
    handle = await createTestDb();
    const c = await convRepo.createConversation({
      title: "x",
      systemPrompt: null,
      lastProvider: "claude",
      limitMarkIndex: null,
      displayMode: "cols",
      visibilityMode: "joined",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    const got = await convRepo.getConversation(c.id);
    expect(got?.displayMode).toBe("cols");
    expect(got?.visibilityMode).toBe("joined");
    expect(got?.lastProvider).toBe("claude");
  });
});

describe("personasRepo", () => {
  async function seedPersona(id: string, slug: string, deletedAt: number | null): Promise<void> {
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults, deleted_at)
       VALUES (?, 'c_1', 'openai', ?, ?, 0, 0, '[]', '{}', ?)`,
      [id, slug, slug, deletedAt],
    );
  }

  it("listPersonas default hides tombstones; includeDeleted=true returns them", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_alive", "alice", null);
    await seedPersona("p_dead", "deceased", 999);
    const live = await personasRepo.listPersonas("c_1");
    expect(live.map((p) => p.id)).toEqual(["p_alive"]);
    const all = await personasRepo.listPersonas("c_1", true);
    expect(all.map((p) => p.id).sort()).toEqual(["p_alive", "p_dead"]);
  });

  it("tombstonePersona stamps deleted_at on the row", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_x", "x", null);
    await personasRepo.tombstonePersona("p_x", 999);
    const all = await personasRepo.listPersonas("c_1", true);
    expect(all.find((p) => p.id === "p_x")?.deletedAt).toBe(999);
  });
});

describe("messagesRepo", () => {
  it("appendMessage allocates monotonic indices starting at 0", async () => {
    handle = await createTestDb();
    await seedConversation();
    const partial = {
      conversationId: "c_1",
      role: "user" as const,
      content: "hi",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines" as const,
      pinned: false,
      pinTarget: null,
      addressedTo: [] as string[],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [] as string[],
    };
    const a = await msgRepo.appendMessage(partial);
    const b = await msgRepo.appendMessage(partial);
    const c = await msgRepo.appendMessage(partial);
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(c.index).toBe(2);
  });

  it("appendMessage stores addressedTo as a JSON column that round-trips empty array", async () => {
    handle = await createTestDb();
    await seedConversation();
    const m = await msgRepo.appendMessage({
      conversationId: "c_1",
      role: "user",
      content: "hi",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: false,
      pinTarget: null,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    const fetched = await msgRepo.getMessage(m.id);
    expect(fetched?.addressedTo).toEqual([]);
  });

  it("getMessage falls back to [] for malformed addressed_to JSON (defensive parse)", async () => {
    handle = await createTestDb();
    await seedConversation();
    // Insert a row with deliberately-broken JSON in addressed_to —
    // simulates a corrupt write or older snapshot import. The row
    // map must NOT throw; a [] fallback is the contract.
    await sql.execute(
      `INSERT INTO messages (
         id, conversation_id, role, content, provider, model, persona_id,
         display_mode, pinned, pin_target, addressed_to, created_at, idx,
         error_message, error_transient, input_tokens, output_tokens, audience,
         ttft_ms, stream_ms
       ) VALUES ('m_1', 'c_1', 'assistant', 'x', 'mock', 'm1', NULL,
                 'lines', 1, NULL, 'not-json', 0, 0, NULL, 0, 0, 0, '[]',
                 NULL, NULL)`,
    );
    const m = await msgRepo.getMessage("m_1");
    expect(m?.addressedTo).toEqual([]);
    expect(m?.pinned).toBe(true);
  });
});

describe("messagesRepo.shiftMessageIndicesFrom", () => {
  it("shifts indices >= fromIdx by the given delta for the conversation", async () => {
    handle = await createTestDb();
    await seedConversation();
    // Append three rows at idx 0..2.
    const partial = {
      conversationId: "c_1",
      role: "user" as const,
      content: "hi",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines" as const,
      pinned: false,
      pinTarget: null,
      addressedTo: [] as string[],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [] as string[],
    };
    await msgRepo.appendMessage(partial);
    await msgRepo.appendMessage(partial);
    await msgRepo.appendMessage(partial);
    await msgRepo.shiftMessageIndicesFrom("c_1", 1, 3);
    const list = await msgRepo.listMessages("c_1");
    expect(list.map((m) => m.index)).toEqual([0, 4, 5]);
  });

  it("is a no-op when delta is 0", async () => {
    handle = await createTestDb();
    await seedConversation();
    const partial = {
      conversationId: "c_1",
      role: "user" as const,
      content: "hi",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines" as const,
      pinned: false,
      pinTarget: null,
      addressedTo: [] as string[],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [] as string[],
    };
    await msgRepo.appendMessage(partial);
    await msgRepo.shiftMessageIndicesFrom("c_1", 0, 0);
    const list = await msgRepo.listMessages("c_1");
    expect(list[0]?.index).toBe(0);
  });
});

describe("settingsRepo", () => {
  it("setSetting upserts: a second call with the same key replaces the value", async () => {
    handle = await createTestDb();
    await settingsRepo.setSetting("theme", "dark");
    expect(await settingsRepo.getSetting("theme")).toBe("dark");
    await settingsRepo.setSetting("theme", "light");
    expect(await settingsRepo.getSetting("theme")).toBe("light");
  });
});
