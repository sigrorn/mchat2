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
  visibilityMatrix: {},
  limitSizeTokens: null,
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
          inputTokens: 0,
          outputTokens: 0,
          usageEstimated: false,
          audience: [],
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

  it("emits trace rows to the sink before/after the stream when wired (#40)", async () => {
    const outboundCalls: string[][] = [];
    const inboundCalls: string[][] = [];
    const order: string[] = [];
    const sink = {
      async outbound(rows: string[]) {
        order.push("O");
        outboundCalls.push(rows);
      },
      async inbound(rows: string[]) {
        order.push("I");
        inboundCalls.push(rows);
      },
    };
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [
        {
          id: "m0",
          conversationId: "c_1",
          role: "user",
          content: "[[MOCK: tokens=hi|there]]",
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
          inputTokens: 0,
          outputTokens: 0,
          usageEstimated: false,
          audience: [],
        },
      ],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      traceSink: sink,
    });
    // Outbound must fire before inbound so a partial-fail leaves the
    // request payload in the file even if no reply was captured.
    expect(order).toEqual(["O", "I"]);
    expect(outboundCalls[0]?.some((r) => / O \[user\] /.test(r))).toBe(true);
    expect(inboundCalls[0]?.some((r) => / I hithere/.test(r))).toBe(true);
  });

  it("does not call the trace sink when none is wired", async () => {
    let called = false;
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [
        {
          id: "m0",
          conversationId: "c_1",
          role: "user",
          content: "[[MOCK: tokens=hi]]",
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
          inputTokens: 0,
          outputTokens: 0,
          usageEstimated: false,
          audience: [],
        },
      ],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      // intentionally no traceSink
    });
    expect(called).toBe(false);
  });

  it("treats a silent run (no tokens, no usage, no error) as failed (#26/#27)", async () => {
    const rec = makeSqlRecorder();
    const silentAdapter = {
      id: "mock" as const,
      async *stream(): AsyncIterable<StreamEvent> {
        // emit nothing — adapter just exits
      },
    };
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
          content: "hi",
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
          inputTokens: 0,
          outputTokens: 0,
          usageEstimated: false,
          audience: [],
        },
      ],
      adapter: silentAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      retry: { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 1, maxDelayMs: 0 },
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.errorMessage).toMatch(/no (response|content|events)/i);
    expect(rec.updates[outcome.messageId]?.errorMessage).toMatch(/no (response|content|events)/i);
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
          inputTokens: 0,
          outputTokens: 0,
          usageEstimated: false,
          audience: [],
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
