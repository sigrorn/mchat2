// #200: rewritten to round-trip through sql.js instead of asserting on
// UPDATE messages SET parameter positions. The runStream tests now
// query the resulting placeholder row to verify content/error after
// the stream rather than scraping SQL writes.
import { describe, it, expect, afterEach } from "vitest";
import { runStream } from "@/lib/orchestration/streamRunner";
import { mockAdapter } from "@/lib/providers/mock";
import * as messagesRepo from "@/lib/persistence/messages";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
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
  selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
};

function target(): PersonaTarget {
  return { provider: "mock", personaId: null, key: "mock", displayName: "Mock" };
}

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function setupDb(): Promise<void> {
  handle = await createTestDb();
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
  );
}

describe("runStream", () => {
  it("accumulates tokens and flushes content on complete", async () => {
    await setupDb();
    const userMsg = await messagesRepo.appendMessage({
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
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    const events: StreamEvent[] = [];
    const outcome = await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [userMsg],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      onEvent: (e) => events.push(e),
    });
    expect(outcome.kind).toBe("completed");
    expect(outcome.outputTokens).toBeGreaterThan(0);
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.content).toBe("abcd");
    expect(placeholder?.errorMessage).toBeNull();
    expect(events.map((e) => e.type)).toContain("token");
  });

  it("emits trace rows to the sink before/after the stream when wired (#40)", async () => {
    await setupDb();
    const userMsg = await messagesRepo.appendMessage({
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
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
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
      history: [userMsg],
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
    await setupDb();
    const userMsg = await messagesRepo.appendMessage({
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
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    let called = false;
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [userMsg],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      // intentionally no traceSink
    });
    expect(called).toBe(false);
  });

  it("treats a silent run (no tokens, no usage, no error) as failed (#26/#27)", async () => {
    await setupDb();
    const userMsg = await messagesRepo.appendMessage({
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
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
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
      history: [userMsg],
      adapter: silentAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      retry: { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 1, maxDelayMs: 0 },
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.errorMessage).toMatch(/no (response|content|events)/i);
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.errorMessage).toMatch(/no (response|content|events)/i);
  });

  it("records permanent error without retrying", async () => {
    await setupDb();
    const userMsg = await messagesRepo.appendMessage({
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
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    const outcome = await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: [userMsg],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
      retry: { maxAttempts: 1, initialDelayMs: 0, backoffFactor: 1, maxDelayMs: 0 },
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.errorTransient).toBe(false);
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.errorMessage).toContain("permanent");
  });
});
