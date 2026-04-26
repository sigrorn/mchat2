// Tests for the renameConversation store convenience — issue #1.
// #200/#191: rewritten onto sql.js round-trips so the test isn't
// coupled to UPDATE conversations parameter positions.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useConversationsStore } from "@/stores/conversationsStore";
import * as convRepo from "@/lib/persistence/conversations";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
  // Seed a real conversation row so the repo's UPDATE has a target.
  await convRepo.createConversation({
    id: "c_1",
    title: "Old title",
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
  useConversationsStore.setState({
    conversations: [(await convRepo.getConversation("c_1"))!],
    currentId: "c_1",
    loaded: true,
  });
});
afterEach(() => {
  useConversationsStore.setState({ conversations: [], currentId: null, loaded: false });
  handle?.restore();
  handle = null;
});

describe("useConversationsStore.rename", () => {
  it("updates the cached title and persists via the repo", async () => {
    await useConversationsStore.getState().rename("c_1", "New shiny name");
    expect(useConversationsStore.getState().conversations[0]?.title).toBe("New shiny name");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("New shiny name");
  });

  it("trims whitespace before persisting", async () => {
    await useConversationsStore.getState().rename("c_1", "   padded   ");
    expect(useConversationsStore.getState().conversations[0]?.title).toBe("padded");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("padded");
  });

  it("rejects empty or whitespace-only titles without hitting the repo", async () => {
    await expect(useConversationsStore.getState().rename("c_1", "   ")).rejects.toThrow();
    expect(useConversationsStore.getState().conversations[0]?.title).toBe("Old title");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("Old title");
  });

  it("is a no-op when the conversation id is unknown", async () => {
    await useConversationsStore.getState().rename("c_999", "ignored");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("Old title");
  });
});
