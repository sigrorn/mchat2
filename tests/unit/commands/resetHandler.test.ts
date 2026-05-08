// ------------------------------------------------------------------
// Component: //reset handler integration test (#294)
// Responsibility: Exercise handleReset against a real DB + the
//                 production migration sequence. Covers the four
//                 modes (full, snapshot, snapshot-N, noop), the
//                 fall-through to full when there are too few
//                 snapshots, distinct reset-id allocation across
//                 consecutive resets (color-group preservation),
//                 and the load-bearing invariant that cost / spend
//                 rollups keep counting hidden rows.
// Collaborators: src/lib/commands/handlers/reset.
// ------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleReset } from "@/lib/commands/handlers/reset";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import type { CommandContext } from "@/lib/commands/handlers/types";
import type { Conversation, Message } from "@/lib/types";

let handle: TestDbHandle | null = null;
beforeEach(async () => {
  handle = await createTestDb();
});
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConv(): Promise<Conversation> {
  return conversationsRepo.createConversation({
    title: "t",
    systemPrompt: null,
    lastProvider: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
}

async function seedUser(conversationId: string, content: string): Promise<Message> {
  return messagesRepo.appendMessage({
    conversationId,
    role: "user",
    content,
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

async function seedAssistant(
  conversationId: string,
  content: string,
  opts: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number | null;
  } = {},
): Promise<Message> {
  return messagesRepo.appendMessage({
    conversationId,
    role: "assistant",
    content,
    provider: "mock",
    model: "mock",
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: opts.inputTokens ?? 100,
    outputTokens: opts.outputTokens ?? 50,
    usageEstimated: false,
    audience: [],
    costUsd: opts.costUsd ?? 0.001,
  });
}

// Insert a COMPACTION block (notice + N pinned `[compacted summary]`
// rows) directly via SQL. Mirrors what runCompactionCommit produces in
// production but bypasses the LLM call so the test stays hermetic.
async function seedCompactionBlock(
  conversationId: string,
  personaIds: readonly string[],
): Promise<{ noticeIndex: number; lastSummaryIndex: number }> {
  const history = await messagesRepo.listMessages(conversationId);
  const startIdx = history.length === 0 ? 0 : history[history.length - 1]!.index + 1;
  const notice = await messagesRepo.appendMessage({
    conversationId,
    role: "notice",
    content: "COMPACTION",
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
  let lastSummaryIndex = notice.index;
  for (const pid of personaIds) {
    // Test seeder uses persona_id: null to avoid the messages.persona_id
    // FK constraint without seeding full persona rows. The handler's
    // snapshot detection looks at role + pinned + content prefix, not
    // at persona linkage.
    const r = await messagesRepo.appendMessage({
      conversationId,
      role: "assistant",
      content: `[compacted summary]\n\nsummary for ${pid}`,
      provider: "mock",
      model: "mock",
      personaId: null,
      displayMode: "lines",
      pinned: true,
      pinTarget: null,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 20,
      usageEstimated: false,
      audience: [],
      costUsd: 0,
    });
    lastSummaryIndex = r.index;
  }
  await sql.execute(
    `UPDATE conversations SET compaction_floor_index = ? WHERE id = ?`,
    [startIdx, conversationId],
  );
  return { noticeIndex: notice.index, lastSummaryIndex };
}

function makeCtx(conv: Conversation, history: readonly Message[]): CommandContext {
  return {
    rawInput: "//reset",
    conversation: conv,
    retry: async () => ({ ok: true }),
    send: async () => ({ ok: true }),
    deps: {
      getMessages: () => history,
      getSupersededIds: () => new Set<string>(),
      getPersonas: () => [],
      getSelection: () => [],
      appendNotice: async (conversationId: string, content: string) =>
        messagesRepo.appendMessage({
          conversationId,
          role: "notice",
          content,
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
        }),
      reloadMessages: async () => {},
      setPinned: async () => {},
      setEditing: () => {},
      setReplayQueue: () => {},
      setVisibilityPreset: async () => {},
      setVisibilityMatrix: async () => {},
      setDisplayMode: async () => {},
      setAutocompact: async () => {},
      setSelection: () => {},
      getFlow: async () => null,
      reloadConversations: async () => {},
      selectConversation: () => {},
      loadPersonas: async () => {},
      loadMessages: async () => {},
    } as unknown as CommandContext["deps"],
  } as CommandContext;
}

describe("handleReset (#294)", () => {
  it("//reset full hides every existing row, leaves cost rollups intact", async () => {
    const conv = await seedConv();
    await seedUser(conv.id, "u1");
    const a1 = await seedAssistant(conv.id, "a1", { costUsd: 0.005 });
    await seedUser(conv.id, "u2");
    const a2 = await seedAssistant(conv.id, "a2", { costUsd: 0.007 });
    const history = await messagesRepo.listMessages(conv.id);
    const ctx = makeCtx(conv, history);

    await handleReset(ctx, { mode: "full" });

    const after = await messagesRepo.listMessages(conv.id);
    const dataRows = after.filter((m) => m.role !== "notice" || m.content !== "reset full.");
    // Every pre-existing row is hidden.
    for (const m of dataRows) {
      if (m.id === a1.id || m.id === a2.id) {
        expect(m.hiddenByResetId).not.toBeNull();
      }
    }
    // Cost preservation: listSpendRows still surfaces both assistant
    // rows with their original costUsd. Hidden rows are not filtered
    // out of spend tracking.
    const spend = await messagesRepo.listSpendRows();
    const totalUsd = spend.reduce((s, r) => s + (r.costUsd ?? 0), 0);
    expect(totalUsd).toBeCloseTo(0.012, 6);
  });

  it("//reset (one snapshot) hides only past the snapshot block; the block stays visible", async () => {
    const conv = await seedConv();
    await seedUser(conv.id, "u1");
    await seedAssistant(conv.id, "a1");
    const block = await seedCompactionBlock(conv.id, ["p1", "p2"]);
    const u2 = await seedUser(conv.id, "u2");
    const a2 = await seedAssistant(conv.id, "a2");
    const history = await messagesRepo.listMessages(conv.id);
    const ctx = makeCtx(conv, history);

    await handleReset(ctx, { mode: "snapshot", count: 1 });

    const after = await messagesRepo.listMessages(conv.id);
    // Snapshot block + everything before stays visible.
    for (const m of after) {
      if (m.index <= block.lastSummaryIndex) {
        expect(m.hiddenByResetId, `idx ${m.index} should be visible`).toBeNull();
      }
    }
    // Past-block rows are hidden.
    const u2After = after.find((m) => m.id === u2.id)!;
    const a2After = after.find((m) => m.id === a2.id)!;
    expect(u2After.hiddenByResetId).not.toBeNull();
    expect(a2After.hiddenByResetId).not.toBeNull();
    // Same reset id (one event = one color group).
    expect(u2After.hiddenByResetId).toBe(a2After.hiddenByResetId);
  });

  it("//reset with no snapshots falls through to full", async () => {
    const conv = await seedConv();
    const u1 = await seedUser(conv.id, "u1");
    const a1 = await seedAssistant(conv.id, "a1");
    const history = await messagesRepo.listMessages(conv.id);
    const ctx = makeCtx(conv, history);

    await handleReset(ctx, { mode: "snapshot", count: 1 });

    const after = await messagesRepo.listMessages(conv.id);
    expect(after.find((m) => m.id === u1.id)?.hiddenByResetId).not.toBeNull();
    expect(after.find((m) => m.id === a1.id)?.hiddenByResetId).not.toBeNull();
  });

  it("//reset 2 hides past the 2nd-to-last visible snapshot", async () => {
    const conv = await seedConv();
    await seedUser(conv.id, "u1");
    await seedAssistant(conv.id, "a1");
    const block1 = await seedCompactionBlock(conv.id, ["p1"]);
    const u2 = await seedUser(conv.id, "u2");
    const a2 = await seedAssistant(conv.id, "a2");
    await seedCompactionBlock(conv.id, ["p1"]);
    const u3 = await seedUser(conv.id, "u3");
    const a3 = await seedAssistant(conv.id, "a3");
    const history = await messagesRepo.listMessages(conv.id);
    const ctx = makeCtx(conv, history);

    await handleReset(ctx, { mode: "snapshot", count: 2 });

    const after = await messagesRepo.listMessages(conv.id);
    // Boundary is the end of block1. Everything past it is hidden.
    for (const m of after) {
      if (m.index <= block1.lastSummaryIndex) {
        expect(m.hiddenByResetId, `idx ${m.index} should be visible`).toBeNull();
      }
    }
    expect(after.find((m) => m.id === u2.id)?.hiddenByResetId).not.toBeNull();
    expect(after.find((m) => m.id === a2.id)?.hiddenByResetId).not.toBeNull();
    expect(after.find((m) => m.id === u3.id)?.hiddenByResetId).not.toBeNull();
    expect(after.find((m) => m.id === a3.id)?.hiddenByResetId).not.toBeNull();
  });

  it("//reset N falls through to full when there are fewer than N snapshots", async () => {
    const conv = await seedConv();
    await seedUser(conv.id, "u1");
    await seedCompactionBlock(conv.id, ["p1"]);
    const u2 = await seedUser(conv.id, "u2");
    const history = await messagesRepo.listMessages(conv.id);
    const ctx = makeCtx(conv, history);

    await handleReset(ctx, { mode: "snapshot", count: 99 });

    const after = await messagesRepo.listMessages(conv.id);
    // Even the snapshot block is hidden under full mode.
    for (const m of after) {
      if (m.id === u2.id) {
        expect(m.hiddenByResetId).not.toBeNull();
      }
      if (m.role === "notice" && m.content === "COMPACTION") {
        expect(m.hiddenByResetId).not.toBeNull();
      }
    }
  });

  it("//reset 0 → no-op (no rows hidden)", async () => {
    const conv = await seedConv();
    const u1 = await seedUser(conv.id, "u1");
    const a1 = await seedAssistant(conv.id, "a1");
    const history = await messagesRepo.listMessages(conv.id);
    const ctx = makeCtx(conv, history);

    await handleReset(ctx, { mode: "noop" });

    const after = await messagesRepo.listMessages(conv.id);
    expect(after.find((m) => m.id === u1.id)?.hiddenByResetId).toBeNull();
    expect(after.find((m) => m.id === a1.id)?.hiddenByResetId).toBeNull();
  });

  it("two consecutive resets allocate distinct reset ids (color-group preservation)", async () => {
    const conv = await seedConv();
    const u1 = await seedUser(conv.id, "u1");
    await seedAssistant(conv.id, "a1");
    let history = await messagesRepo.listMessages(conv.id);

    await handleReset(makeCtx(conv, history), { mode: "full" });
    history = await messagesRepo.listMessages(conv.id);
    const firstResetId = history.find((m) => m.id === u1.id)?.hiddenByResetId;
    expect(firstResetId).not.toBeNull();

    // New activity, then another reset. The previously-hidden rows
    // must keep their first reset id; the new tail must get a new id.
    const u2 = await seedUser(conv.id, "u2");
    history = await messagesRepo.listMessages(conv.id);
    await handleReset(makeCtx(conv, history), { mode: "full" });
    history = await messagesRepo.listMessages(conv.id);
    const u1After = history.find((m) => m.id === u1.id);
    const u2After = history.find((m) => m.id === u2.id);
    expect(u1After?.hiddenByResetId).toBe(firstResetId);
    expect(u2After?.hiddenByResetId).not.toBeNull();
    expect(u2After?.hiddenByResetId).not.toBe(firstResetId);
  });
});
