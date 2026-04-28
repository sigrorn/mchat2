import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { useMessagesStore } from "@/stores/messagesStore";
import { useSendStore } from "@/stores/sendStore";
import { makeMessage } from "@/lib/persistence/messages";
import { getRepoQueryCache, __resetRepoQueryCache } from "@/lib/data/useRepoQuery";
import type { Message } from "@/lib/types";

beforeEach(() => {
  __setImpl({
    async execute() {
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (q.includes("MAX(idx)")) return [{ next: 0 } as unknown as T];
      return [];
    },
    async close() {},
  });
  __resetRepoQueryCache();
  // Pre-warm the cache so append() (which uses cache.update with a
  // no-op-if-missing semantic) actually lands.
  getRepoQueryCache().set<Message[]>(["messages", "c_1"], []);
  useSendStore.setState({ runIdByConversation: {}, activeByConversation: {} });
});
afterEach(() => __resetImpl());

describe("messagesStore", () => {
  it("patchContent updates existing row in place", () => {
    const m = makeMessage({ conversationId: "c_1", id: "m_1", content: "" });
    useMessagesStore.getState().append(m);
    useMessagesStore.getState().patchContent("c_1", "m_1", "hello");
    const list = getRepoQueryCache().get<Message[]>(["messages", "c_1"]);
    expect(list?.[0]?.content).toBe("hello");
  });

  it("sendUserMessage persists and appends", async () => {
    const m = await useMessagesStore.getState().sendUserMessage({
      conversationId: "c_1",
      content: "hi",
      addressedTo: [],
    });
    expect(m.role).toBe("user");
    expect(getRepoQueryCache().get<Message[]>(["messages", "c_1"])?.length).toBe(1);
  });
});

describe("sendStore", () => {
  it("nextRunId is monotonic per conversation", () => {
    const s = useSendStore.getState();
    expect(s.nextRunId("c_1")).toBe(1);
    expect(s.nextRunId("c_1")).toBe(2);
    expect(s.nextRunId("c_2")).toBe(1);
  });

  it("cancelAll aborts every controller and clears the list", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    useSendStore.getState().registerStream("c_1", {
      streamId: "s1",
      controller: c1,
      target: "a",
      startedAt: 0,
    });
    useSendStore.getState().registerStream("c_1", {
      streamId: "s2",
      controller: c2,
      target: "b",
      startedAt: 0,
    });
    useSendStore.getState().cancelAll("c_1");
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(useSendStore.getState().activeByConversation["c_1"]).toEqual([]);
  });
});
