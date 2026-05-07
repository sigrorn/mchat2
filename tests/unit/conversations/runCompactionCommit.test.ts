// #268 — runCompaction's index-shift + insert + floor-write block
// must be atomic. A failure mid-loop must roll back ALL of
// (shifts, notice, partial summaries, floor move) so the conversation
// looks identical to its pre-compaction state.
//
// We test the extracted DB-phase helper directly (the LLM phase has
// no DB writes; isolating the helper is easier than mocking provider
// adapters).
import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import * as personasRepo from "@/lib/persistence/personas";
import { commitCompactionWrites } from "@/lib/conversations/runCompactionCommit";
import type { Conversation, Persona } from "@/lib/types";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
  vi.restoreAllMocks();
});

const baseConv: Conversation = {
  id: "c1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  displayMode: "lines",
  visibilityMode: "joined",
  visibilityMatrix: {},
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

function persona(id: string): Persona {
  return {
    id,
    conversationId: "c1",
    provider: "mock",
    name: id,
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: "mock-1",
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  };
}

// #275 helper: snapshot the junction-table rowids for a conversation
// so the test can detect any DELETE+INSERT (rowids would change /
// disappear).
async function fetchJunctionRowids(conversationId: string): Promise<{
  selected: number[];
  warnings: number[];
  visibility: number[];
}> {
  const { sql } = await import("@/lib/tauri/sql");
  const selected = await sql.select<{ rowid: number }>(
    `SELECT rowid FROM conversation_personas_selected WHERE conversation_id = ? ORDER BY rowid`,
    [conversationId],
  );
  const warnings = await sql.select<{ rowid: number }>(
    `SELECT rowid FROM conversation_context_warnings WHERE conversation_id = ? ORDER BY rowid`,
    [conversationId],
  );
  const visibility = await sql.select<{ rowid: number }>(
    `SELECT rowid FROM persona_visibility WHERE conversation_id = ? ORDER BY rowid`,
    [conversationId],
  );
  return {
    selected: selected.map((r) => r.rowid),
    warnings: warnings.map((r) => r.rowid),
    visibility: visibility.map((r) => r.rowid),
  };
}

async function seedConv(): Promise<Conversation> {
  await conversationsRepo.createConversation(baseConv);
  // Personas referenced by inserted summary rows must exist (FK
  // messages.persona_id → personas.id).
  await personasRepo.createPersona(persona("p1"));
  await personasRepo.createPersona(persona("p2"));
  // Three messages to seed: idx 0,1,2.
  for (let i = 0; i < 3; i++) {
    await messagesRepo.appendMessage({
      conversationId: "c1",
      role: i === 1 ? "assistant" : "user",
      content: `m${i}`,
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
  }
  return baseConv;
}

describe("commitCompactionWrites (regression #268)", () => {
  it("commits shifts + notice + summaries + floor atomically on success", async () => {
    handle = await createTestDb();
    const conv = await seedConv();
    const before = await messagesRepo.listMessages("c1");
    expect(before).toHaveLength(3);

    await commitCompactionWrites(conv, /* cutoff */ 1, [
      {
        personaId: "p1",
        provider: "mock",
        model: "mock-1",
        summary: "summary A",
        ttftMs: 10,
        streamMs: 100,
        reportedOutputTokens: 5,
      },
    ]);

    const after = await messagesRepo.listMessages("c1");
    // 3 originals + 1 notice + 1 summary = 5; original idx>=1 shifted by 2
    expect(after).toHaveLength(5);
    // Pre-cutoff message (idx 0) untouched
    expect(after[0]?.content).toBe("m0");
    expect(after[0]?.index).toBe(0);
    // Notice at cutoff
    expect(after[1]?.role).toBe("notice");
    expect(after[1]?.content).toBe("COMPACTION");
    expect(after[1]?.index).toBe(1);
    // Summary at cutoff+1
    expect(after[2]?.role).toBe("assistant");
    expect(after[2]?.content).toContain("summary A");
    expect(after[2]?.index).toBe(2);
    // Original idx 1 shifted to idx 3
    expect(after[3]?.content).toBe("m1");
    expect(after[3]?.index).toBe(3);
    // Floor moved
    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.compactionFloorIndex).toBe(1);
  });

  // #275: the commit phase used to move the floor via the full
  // updateConversation, which rewrites every conversation column AND
  // re-DELETE/INSERTs the conversation_personas_selected, conversation_
  // context_warnings, and persona_visibility junction tables. To move
  // ONE integer column. Pin that we use a narrow setter instead.
  it("moves the compaction floor without rewriting unrelated junction tables (#275)", async () => {
    handle = await createTestDb();
    const conv = await seedConv();

    // Seed the junction tables with sentinel rows so we can detect a
    // rewrite via row identity (rowid). The narrow setter must leave
    // them alone; the old full updateConversation path would DELETE +
    // INSERT them on every call. We need a 3rd persona for the
    // visibility matrix to survive the loader's sparse-matrix filter
    // (an observer with no visible=0 rows is dropped).
    await personasRepo.createPersona({ ...persona("p3"), sortOrder: 2 });
    await conversationsRepo.updateConversation({
      ...conv,
      selectedPersonas: ["p1"],
      contextWarningsFired: [80],
      visibilityMatrix: { p1: ["p2"] }, // p1 sees p2, hides p3
    });
    const before = await fetchJunctionRowids("c1");

    // Spy on updateConversation — the heavy rewrite. The narrow setter
    // (setCompactionFloor on the repo) is what we want called instead.
    const heavySpy = vi.spyOn(conversationsRepo, "updateConversation");

    await commitCompactionWrites(conv, /* cutoff */ 1, [
      {
        personaId: "p1",
        provider: "mock",
        model: "mock-1",
        summary: "summary A",
        ttftMs: 10,
        streamMs: 100,
        reportedOutputTokens: 5,
      },
    ]);

    // The full rewrite must not be called from inside the compaction
    // commit — that would trigger the junction-table churn.
    expect(heavySpy).not.toHaveBeenCalled();

    // Junction-table rowids must be unchanged: no DELETE+INSERT happened.
    const after = await fetchJunctionRowids("c1");
    expect(after).toEqual(before);

    // Floor still moved (the narrow setter did its job).
    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.compactionFloorIndex).toBe(1);
    // Plus all the other state the existing atomicity test pins.
    expect(reloaded?.selectedPersonas).toEqual(["p1"]);
    expect(reloaded?.contextWarningsFired).toEqual([80]);
    expect(reloaded?.visibilityMatrix).toEqual({ p1: ["p2"] });
  });

  it("rolls back shifts and inserts when an insertMessageAtIndex throws mid-loop", async () => {
    handle = await createTestDb();
    const conv = await seedConv();

    // Force the THIRD insertMessageAtIndex call to throw (notice = 1st,
    // first summary = 2nd, second summary = 3rd → fails mid-loop).
    let calls = 0;
    const real = messagesRepo.insertMessageAtIndex;
    const spy = vi.spyOn(messagesRepo, "insertMessageAtIndex").mockImplementation(
      async (args, dbi) => {
        calls += 1;
        if (calls === 3) throw new Error("synthetic mid-loop failure");
        return real(args, dbi);
      },
    );

    await expect(
      commitCompactionWrites(conv, 1, [
        {
          personaId: "p1",
          provider: "mock",
          model: "mock-1",
          summary: "summary A",
          ttftMs: 10,
          streamMs: 100,
          reportedOutputTokens: 5,
        },
        {
          personaId: "p2",
          provider: "mock",
          model: "mock-1",
          summary: "summary B",
          ttftMs: 10,
          streamMs: 100,
          reportedOutputTokens: 5,
        },
      ]),
    ).rejects.toThrow("synthetic mid-loop failure");

    spy.mockRestore();

    // EVERYTHING must be unchanged: original 3 messages, no notice,
    // no summaries, no shifts, floor still null.
    const after = await messagesRepo.listMessages("c1");
    expect(after).toHaveLength(3);
    expect(after.map((m) => m.content)).toEqual(["m0", "m1", "m2"]);
    expect(after.map((m) => m.index)).toEqual([0, 1, 2]);
    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.compactionFloorIndex).toBeNull();
  });
});
