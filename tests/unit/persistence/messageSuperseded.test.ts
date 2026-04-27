// #206 follow-up — message-level superseded marker. Replay/retry
// hide trailing assistant rows by stamping messages.superseded_at
// directly, so the UI's filterSupersededMessages catches them
// regardless of whether the underlying attempts have the
// att_<msgId> id or a random one (the convention only landed in
// #205, after a window of random ids was already in production).
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import { listSupersededMessageIds } from "@/lib/persistence/runs";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConv(id = "c1"): Promise<void> {
  await conversationsRepo.createConversation({
    id,
    title: "t",
    systemPrompt: null,
    lastProvider: null,
    limitMarkIndex: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    limitSizeTokens: null,
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
}

async function seedAssistant(id: string, idx: number): Promise<void> {
  await messagesRepo.appendMessage({
    id,
    conversationId: "c1",
    role: "assistant",
    content: `reply ${id}`,
    provider: "mock",
    model: "mock",
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
  void idx;
}

describe("markMessagesSuperseded (#206)", () => {
  it("stamps superseded_at on the named messages", async () => {
    handle = await createTestDb();
    await seedConv();
    await seedAssistant("a1", 1);
    await seedAssistant("a2", 2);

    await messagesRepo.markMessagesSuperseded(["a1"], 9999);

    const rows = await messagesRepo.listMessages("c1");
    expect(rows.find((m) => m.id === "a1")?.supersededAt).toBe(9999);
    expect(rows.find((m) => m.id === "a2")?.supersededAt).toBeNull();
  });

  it("listSupersededMessageIds returns the marked ids regardless of attempt-id format", async () => {
    handle = await createTestDb();
    await seedConv();
    await seedAssistant("a1", 1);
    await seedAssistant("a2", 2);
    await seedAssistant("a3", 3);

    await messagesRepo.markMessagesSuperseded(["a1", "a3"], 9999);

    const ids = await listSupersededMessageIds("c1");
    expect(ids).toEqual(new Set(["a1", "a3"]));
  });

  it("is idempotent — re-marking the same id keeps it marked", async () => {
    handle = await createTestDb();
    await seedConv();
    await seedAssistant("a1", 1);

    await messagesRepo.markMessagesSuperseded(["a1"], 1000);
    await messagesRepo.markMessagesSuperseded(["a1"], 2000);

    const rows = await messagesRepo.listMessages("c1");
    // Latest stamp wins — most recent supersede event.
    expect(rows[0]?.supersededAt).toBe(2000);
  });

  it("no-ops on empty input", async () => {
    handle = await createTestDb();
    await seedConv();
    await seedAssistant("a1", 1);

    await messagesRepo.markMessagesSuperseded([], 1000);

    const rows = await messagesRepo.listMessages("c1");
    expect(rows[0]?.supersededAt).toBeNull();
  });
});
