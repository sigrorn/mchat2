// #269 — snapshotImport must be atomic. A failure mid-import must
// roll back the conversation row, all created personas, all imported
// messages, and any flow rows. The user must NOT see a half-formed
// conversation in the sidebar.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { importSnapshot } from "@/lib/conversations/snapshotImport";
import { parseSnapshot } from "@/lib/schemas/snapshot";
import * as messagesRepo from "@/lib/persistence/messages";
import * as personasRepo from "@/lib/persistence/personas";
import * as conversationsRepo from "@/lib/persistence/conversations";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
  vi.restoreAllMocks();
});

function buildSnapshot(opts: { messageCount: number }): string {
  const messages = Array.from({ length: opts.messageCount }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `m${i}`,
    persona: i % 2 === 0 ? null : "Alice",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    audience: [],
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    errorMessage: null,
    errorTransient: false,
    displayMode: "lines",
    provider: i % 2 === 0 ? null : "mock",
    model: i % 2 === 0 ? null : "mock-1",
    index: i,
    createdAt: 1000 + i,
  }));
  return JSON.stringify({
    version: 1 as const,
    title: "ImportTest",
    systemPrompt: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    compactionFloorIndex: null,
    selectedPersonas: [],
    personas: [
      {
        name: "Alice",
        provider: "mock",
        systemPromptOverride: null,
        modelOverride: null,
        colorOverride: null,
        visibilityDefaults: {},
        sortOrder: 0,
        createdAtMessageIndex: 0,
      },
    ],
    messages,
  });
}

describe("importSnapshot atomicity (regression #269)", () => {
  it("rolls back conversation + personas + messages when a mid-import write fails", async () => {
    handle = await createTestDb();
    const parsed = parseSnapshot(buildSnapshot({ messageCount: 4 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const beforeConversations = await conversationsRepo.listConversations();
    const beforePersonas = (
      await Promise.all(
        beforeConversations.map((c) => personasRepo.listPersonas(c.id, true)),
      )
    ).flat();

    // #278: snapshotImport now batches messages through
    // bulkAppendMessages instead of per-row appendMessage. Force the
    // bulk write to throw to simulate a mid-import failure; the
    // atomicity contract (whole transaction rolls back) is identical.
    vi.spyOn(messagesRepo, "bulkAppendMessages").mockImplementation(
      async () => {
        throw new Error("synthetic mid-import failure");
      },
    );

    await expect(importSnapshot(parsed.snapshot)).rejects.toThrow(
      "synthetic mid-import failure",
    );

    // Conversation list unchanged — no half-formed row.
    const afterConversations = await conversationsRepo.listConversations();
    expect(afterConversations).toHaveLength(beforeConversations.length);
    // No new personas created either (the snapshot's "Alice" must NOT
    // be visible in any conversation).
    const afterPersonas = (
      await Promise.all(
        afterConversations.map((c) => personasRepo.listPersonas(c.id, true)),
      )
    ).flat();
    expect(afterPersonas).toHaveLength(beforePersonas.length);
  });

  it("commits on success: conversation, personas, and messages all land", async () => {
    handle = await createTestDb();
    const parsed = parseSnapshot(buildSnapshot({ messageCount: 4 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await importSnapshot(parsed.snapshot);
    expect(result.conversation.title).toBe("ImportTest");
    const personas = await personasRepo.listPersonas(result.conversation.id);
    expect(personas.map((p) => p.name)).toEqual(["Alice"]);
    const messages = await messagesRepo.listMessages(result.conversation.id);
    expect(messages).toHaveLength(4);
  });
});
