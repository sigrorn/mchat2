// ------------------------------------------------------------------
// Component: //fork handler integration test (#224)
// Responsibility: Pin the error-path behaviour — when the use case
//                 throws ForkRangeError because userNumber is out of
//                 range, the handler surfaces the message as a notice
//                 on the source conversation and asks the Composer to
//                 restore the rawInput. The success path is exercised
//                 via the forkConversation tests + manual end-to-end.
// Collaborators: src/lib/commands/handlers/fork.
// ------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleFork } from "@/lib/commands/handlers/fork";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
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

async function seedConversation(): Promise<Conversation> {
  return conversationsRepo.createConversation({
    title: "Source",
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

function makeCtx(conv: Conversation, history: readonly Message[]): CommandContext {
  return {
    rawInput: "//fork 99",
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
      // #224: handler reads source flow + switches stores. The
      // out-of-range path bails before touching switch deps, so these
      // can be no-ops for this test.
      getFlow: async () => null,
      reloadConversations: async () => {},
      selectConversation: () => {},
      loadPersonas: async () => {},
      loadMessages: async () => {},
    } as unknown as CommandContext["deps"],
  } as CommandContext;
}

describe("handleFork (#224) — out-of-range error path", () => {
  it("appends a notice to the source and returns restoreText when N exceeds the user-message count", async () => {
    const conv = await seedConversation();
    const ctx = makeCtx(conv, []);
    const result = await handleFork(ctx, { userNumber: 99 });
    expect(result).toEqual({ restoreText: "//fork 99" });
    const msgs = await messagesRepo.listMessages(conv.id);
    const notice = msgs.find((m) => m.role === "notice");
    expect(notice).toBeDefined();
    expect(notice!.content).toMatch(/user message 99 does not exist/i);
    // No new conversation should have been created.
    const all = await conversationsRepo.listConversations();
    expect(all).toHaveLength(1);
  });
});
