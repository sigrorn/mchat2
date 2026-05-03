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

  // #248: ChatView calls load() from a useEffect on every conversation
  // activation. Pre-fix, load() always overwrote the cache with the
  // SQLite snapshot — but the streaming pump only persists final
  // content at completion (streamRunner's success/error branch), so a
  // refetch mid-stream returned the empty placeholder and wiped the
  // tokens accumulated so far. The next patchContent then wrote
  // "" + newTokens, dropping everything streamed before the switch.
  // load() must be a no-op when the cache is already authoritative.
  it("load() is a no-op when the cache is already populated (#248)", async () => {
    // Simulate the streaming pump having patched content into the
    // cache. The "DB" is set up to return an empty placeholder, which
    // is what's actually stored mid-stream.
    const placeholder = makeMessage({
      conversationId: "c_stream",
      id: "m_stream",
      content: "tokens streamed mid-flight",
    });
    getRepoQueryCache().set<Message[]>(["messages", "c_stream"], [placeholder]);

    let listMessagesIssued = false;
    __setImpl({
      async execute() {
        return { rowsAffected: 1, lastInsertId: null };
      },
      async select<T>(q: string): Promise<T[]> {
        if (/from\s+"?messages"?/i.test(q)) {
          listMessagesIssued = true;
        }
        if (q.includes("MAX(idx)")) return [{ next: 0 } as unknown as T];
        return [];
      },
      async close() {},
    });

    await useMessagesStore.getState().load("c_stream");

    expect(listMessagesIssued).toBe(false);
    const list = getRepoQueryCache().get<Message[]>(["messages", "c_stream"]);
    expect(list?.[0]?.content).toBe("tokens streamed mid-flight");
  });

  it("load() fetches and seeds when the cache is empty (#248)", async () => {
    // Empty cache for a never-visited conversation — first activation
    // is the legitimate population path.
    __resetRepoQueryCache();

    let listMessagesIssued = false;
    __setImpl({
      async execute() {
        return { rowsAffected: 1, lastInsertId: null };
      },
      async select<T>(q: string): Promise<T[]> {
        if (/from\s+"?messages"?/i.test(q)) {
          listMessagesIssued = true;
        }
        if (q.includes("MAX(idx)")) return [{ next: 0 } as unknown as T];
        return [];
      },
      async close() {},
    });

    await useMessagesStore.getState().load("c_fresh");

    expect(listMessagesIssued).toBe(true);
    expect(getRepoQueryCache().get<Message[]>(["messages", "c_fresh"])).toEqual([]);
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
