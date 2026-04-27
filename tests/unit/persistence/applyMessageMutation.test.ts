// Reproduce the regression report: "edit on user message reverts to
// old text". The replay flow's only DB change is applyMessageMutation;
// if THAT works under createTestDb, the bug is downstream.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import { transaction } from "@/lib/persistence/transaction";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("applyMessageMutation under transaction (regression repro 2026-04-27)", () => {
  it("updates the user message content + addressedTo and the change persists across listMessages", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation({
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
    const userMsg = await messagesRepo.appendMessage({
      conversationId: "c1",
      role: "user",
      content: "original text",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: false,
      pinTarget: null,
      addressedTo: ["p_a"],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });

    // Replay the exact pattern replayMessage uses.
    await transaction(async () => {
      await messagesRepo.applyMessageMutation({
        id: userMsg.id,
        content: "edited text",
        addressedTo: ["p_b", "p_c"],
      });
    });

    const after = await messagesRepo.listMessages("c1");
    const reloaded = after.find((m) => m.id === userMsg.id);
    expect(reloaded?.content).toBe("edited text");
    expect(reloaded?.addressedTo).toEqual(["p_b", "p_c"]);
  });
});
