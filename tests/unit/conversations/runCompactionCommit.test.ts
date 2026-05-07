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
import { commitCompactionWrites } from "@/lib/conversations/runCompactionCommit";
import type { Conversation } from "@/lib/types";

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

async function seedConv(): Promise<Conversation> {
  await conversationsRepo.createConversation(baseConv);
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
