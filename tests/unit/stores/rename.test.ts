// Tests for the renameConversation store convenience — issue #1.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { useConversationsStore } from "@/stores/conversationsStore";
import type { Conversation } from "@/lib/types";

function seedConv(over: Partial<Conversation> = {}): Conversation {
  return {
    id: "c_1",
    title: "Old title",
    systemPrompt: null,
    createdAt: 1,
    lastProvider: null,
    limitMarkIndex: null,
    displayMode: "lines",
    visibilityMode: "separated",
    visibilityMatrix: {},
    limitSizeTokens: null,
    selectedPersonas: [],
    compactionFloorIndex: null,
    ...over,
  };
}

let updateCalls: { sql: string; params: unknown[] }[];
beforeEach(() => {
  updateCalls = [];
  __setImpl({
    async execute(q, p) {
      if (q.startsWith("UPDATE conversations")) updateCalls.push({ sql: q, params: p ?? [] });
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(): Promise<T[]> {
      return [];
    },
    async close() {},
  });
  useConversationsStore.setState({
    conversations: [seedConv()],
    currentId: "c_1",
    loaded: true,
  });
});
afterEach(() => {
  __resetImpl();
  useConversationsStore.setState({ conversations: [], currentId: null, loaded: false });
});

describe("useConversationsStore.rename", () => {
  it("updates the cached title and persists via the repo", async () => {
    await useConversationsStore.getState().rename("c_1", "New shiny name");
    expect(useConversationsStore.getState().conversations[0]?.title).toBe("New shiny name");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.params[0]).toBe("New shiny name");
  });

  it("trims whitespace before persisting", async () => {
    await useConversationsStore.getState().rename("c_1", "   padded   ");
    expect(useConversationsStore.getState().conversations[0]?.title).toBe("padded");
  });

  it("rejects empty or whitespace-only titles without hitting the repo", async () => {
    await expect(useConversationsStore.getState().rename("c_1", "   ")).rejects.toThrow();
    expect(updateCalls).toHaveLength(0);
    expect(useConversationsStore.getState().conversations[0]?.title).toBe("Old title");
  });

  it("is a no-op when the conversation id is unknown", async () => {
    await useConversationsStore.getState().rename("c_999", "ignored");
    expect(updateCalls).toHaveLength(0);
  });
});
