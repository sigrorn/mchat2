// Integration repro for the regression "//pop no longer removes
// messages" reported 2026-04-27. Exercises handlePop through
// createTestDb so we hit the real SQL + transaction machinery.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import { handlePop } from "@/lib/commands/handlers/history";
import type { CommandContext } from "@/lib/commands/handlers/types";
import type { Conversation, Message } from "@/lib/types";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversation(): Promise<Conversation> {
  return conversationsRepo.createConversation({
    id: "c1",
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

async function seedTurn(conversationId: string, userText: string, assistantText: string): Promise<{ user: Message; assistant: Message }> {
  const user = await messagesRepo.appendMessage({
    conversationId,
    role: "user",
    content: userText,
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
  const assistant = await messagesRepo.appendMessage({
    conversationId,
    role: "assistant",
    content: assistantText,
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
  return { user, assistant };
}

function makeCtx(conv: Conversation, history: readonly Message[]): CommandContext {
  return {
    rawInput: "//pop",
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
      setLimit: async () => {},
      setLimitSize: async () => {},
      setVisibilityPreset: async () => {},
      setVisibilityMatrix: async () => {},
      setDisplayMode: async () => {},
    } as unknown as CommandContext["deps"],
  } as CommandContext;
}

describe("//pop integration (#regression report 2026-04-27)", () => {
  it("removes the last user message and its assistant reply from the messages table", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedTurn(conv.id, "first", "first reply");
    const turn2 = await seedTurn(conv.id, "second", "second reply");
    const before = await messagesRepo.listMessages(conv.id);
    expect(before).toHaveLength(4);

    const ctx = makeCtx(conv, before);
    await handlePop(ctx, { userNumber: null });

    const after = await messagesRepo.listMessages(conv.id);
    // Both rows of turn2 must be gone; the notice replaces them.
    expect(after.find((m) => m.id === turn2.user.id)).toBeUndefined();
    expect(after.find((m) => m.id === turn2.assistant.id)).toBeUndefined();
    // First turn survives, plus the notice that //pop ran.
    expect(after.filter((m) => m.role === "notice")).toHaveLength(1);
    expect(after.filter((m) => m.role !== "notice")).toHaveLength(2);
  });
});
