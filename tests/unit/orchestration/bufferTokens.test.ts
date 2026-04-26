// streamRunner.bufferTokens suppresses per-token onEvent calls — issue #16.
// #200: rewritten to round-trip through sql.js instead of asserting on
// UPDATE messages SET content parameter positions.
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

async function seedConversationAndUserMessage(): Promise<string> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
  );
  const m = await messagesRepo.appendMessage({
    conversationId: "c_1",
    role: "user",
    content: "[[MOCK: tokens=ab|cd|ef]]",
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
  return m.id;
}

describe("streamRunner.bufferTokens", () => {
  it("when bufferTokens=true, onEvent is NOT called for token events but the final UPDATE flushes content", async () => {
    handle = await createTestDb();
    const userMsgId = await seedConversationAndUserMessage();
    const userMsg = await messagesRepo.getMessage(userMsgId);
    const events: StreamEvent[] = [];
    const outcome = await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: userMsg ? [userMsg] : [],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "cols",
      bufferTokens: true,
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === "token")).toBe(false);
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.content).toBe("abcdef");
  });

  it("when bufferTokens=false (default), onEvent receives tokens", async () => {
    handle = await createTestDb();
    const userMsgId = await seedConversationAndUserMessage();
    const userMsg = await messagesRepo.getMessage(userMsgId);
    const events: StreamEvent[] = [];
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history: userMsg ? [userMsg] : [],
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
