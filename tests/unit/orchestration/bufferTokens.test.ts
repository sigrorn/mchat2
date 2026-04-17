// streamRunner.bufferTokens suppresses per-token onEvent calls — issue #16.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { runStream } from "@/lib/orchestration/streamRunner";
import { mockAdapter } from "@/lib/providers/mock";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, PersonaTarget, StreamEvent } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitSizeTokens: null,
};

function target(): PersonaTarget {
  return { provider: "mock", personaId: null, key: "mock", displayName: "Mock" };
}

let updates: { sql: string; params: unknown[] }[];
beforeEach(() => {
  updates = [];
  __setImpl({
    async execute(q, p) {
      updates.push({ sql: q, params: p ?? [] });
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (q.includes("MAX(idx)")) return [{ next: 0 } as unknown as T];
      return [];
    },
    async close() {},
  });
});
afterEach(() => __resetImpl());

describe("streamRunner.bufferTokens", () => {
  const history = [
    makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "[[MOCK: tokens=ab|cd|ef]]",
      index: 0,
    }),
  ];

  it("when bufferTokens=true, onEvent is NOT called for token events", async () => {
    const events: StreamEvent[] = [];
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history,
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "cols",
      bufferTokens: true,
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "token")).toBe(false);
    // But the final UPDATE still flushes the accumulated content.
    const contentUpdate = updates.find((c) => c.sql.startsWith("UPDATE messages SET content"));
    expect(contentUpdate?.params[0]).toBe("abcdef");
  });

  it("when bufferTokens=false (default), onEvent receives tokens", async () => {
    const events: StreamEvent[] = [];
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history,
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      onEvent: (e) => events.push(e),
    });
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBeGreaterThan(0);
  });
});
