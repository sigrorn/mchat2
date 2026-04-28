// Tests for the renameConversation store convenience — issue #1.
// #200/#191: rewritten onto sql.js round-trips so the test isn't
// coupled to UPDATE conversations parameter positions.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useConversationsStore } from "@/stores/conversationsStore";
import * as convRepo from "@/lib/persistence/conversations";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { getRepoQueryCache, __resetRepoQueryCache } from "@/lib/data/useRepoQuery";
import type { Conversation } from "@/lib/types";

let handle: TestDbHandle | null = null;

beforeEach(async () => {
  handle = await createTestDb();
  __resetRepoQueryCache();
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
  // Seed the cache so cacheGet() inside the store finds the row.
  getRepoQueryCache().set<Conversation[]>(
    ["conversations"],
    [(await convRepo.getConversation("c_1"))!],
  );
  useConversationsStore.setState({ currentId: "c_1", loaded: true });
});
afterEach(() => {
  useConversationsStore.setState({ currentId: null, loaded: false });
  handle?.restore();
  handle = null;
});

function cachedTitle(): string | undefined {
  return getRepoQueryCache().get<Conversation[]>(["conversations"])?.[0]?.title;
}

describe("useConversationsStore.rename", () => {
  it("updates the cached title and persists via the repo", async () => {
    await useConversationsStore.getState().rename("c_1", "New shiny name");
    expect(cachedTitle()).toBe("New shiny name");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("New shiny name");
  });

  it("trims whitespace before persisting", async () => {
    await useConversationsStore.getState().rename("c_1", "   padded   ");
    expect(cachedTitle()).toBe("padded");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("padded");
  });

  it("rejects empty or whitespace-only titles without hitting the repo", async () => {
    await expect(useConversationsStore.getState().rename("c_1", "   ")).rejects.toThrow();
    expect(cachedTitle()).toBe("Old title");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("Old title");
  });

  it("is a no-op when the conversation id is unknown", async () => {
    await useConversationsStore.getState().rename("c_999", "ignored");
    const persisted = await convRepo.getConversation("c_1");
    expect(persisted?.title).toBe("Old title");
  });
});
