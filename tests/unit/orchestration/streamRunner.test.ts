import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { runStream } from "@/lib/orchestration/streamRunner";
import { mockAdapter } from "@/lib/providers/mock";
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
};

function target(): PersonaTarget {
  return { provider: "mock", personaId: null, key: "mock", displayName: "Mock" };
}

function makeSqlRecorder() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const updates: Record<string, { content: string; errorMessage: string | null }> = {};
  __setImpl({
    async execute(q, p) {
      calls.push({ sql: q, params: p ?? [] });
      if (q.startsWith("UPDATE messages SET content")) {
        const ps = p ?? [];
        updates[String(ps[3])] = {
          content: String(ps[0]),
          errorMessage: ps[1] === null ? null : String(ps[1]),
        };
      }
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (q.includes("MAX(idx)")) return [{ next: 0 } as unknown as T];
      return [];
    },
    async close() {},
  });
  return { calls, updates };
}

beforeEach(() => makeSqlRecorder());
afterEach(() => __resetImpl());

describe("runStream", () => {
  it("accumulates tokens and flushes content on complete", async () => {
    const rec = makeSqlRecorder();
    const events: StreamEvent[] = [];
    const outcome = await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [
        {
          id: "m0",
          conversationId: "c_1",
          role: "user",
          content: "[[MOCK: tokens=ab|cd]]",
          provider: null,
          model: null,
          personaId: null,
          displayMode: "lines",
          pinned: false,
          pinTarget: null,
          addressedTo: [],
          createdAt: 0,
          index: 0,
          errorMessage: null,
          errorTransient: false,
        },
      ],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      onEvent: (e) => events.push(e),
    });
    expect(outcome.kind).toBe("completed");
    expect(outcome.outputTokens).toBeGreaterThan(0);
    const updated = rec.updates[outcome.messageId];
    expect(updated?.content).toBe("abcd");
    expect(updated?.errorMessage).toBeNull();
    expect(events.map((e) => e.type)).toContain("token");
  });

  it("records permanent error without retrying", async () => {
    const rec = makeSqlRecorder();
    const outcome = await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [
        {
          id: "m0",
          conversationId: "c_1",
          role: "user",
          content: "[[MOCK: error=permanent]]",
          provider: null,
          model: null,
          personaId: null,
          displayMode: "lines",
          pinned: false,
          pinTarget: null,
          addressedTo: [],
          createdAt: 0,
          index: 0,
          errorMessage: null,
          errorTransient: false,
        },
      ],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      retry: { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 1, maxDelayMs: 0 },
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.errorTransient).toBe(false);
    expect(rec.updates[outcome.messageId]?.errorMessage).toContain("permanent");
  });
});
