// streamRunner populates assistant.audience from the prior user row — issue #4.
// #200: rewritten to round-trip through sql.js instead of asserting on
// INSERT INTO messages parameter positions.
import { describe, it, expect, afterEach } from "vitest";
import { runStream } from "@/lib/orchestration/streamRunner";
import { mockAdapter } from "@/lib/providers/mock";
import * as messagesRepo from "@/lib/persistence/messages";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import type { Conversation, PersonaTarget } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

function target(key: string): PersonaTarget {
  return { provider: "mock", personaId: key, key, displayName: key };
}

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversationAndPersonas(): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
  );
  for (const pid of ["p_a", "p_b"]) {
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, visibility_defaults)
       VALUES (?, 'c_1', 'mock', ?, ?, 0, 0, '{}')`,
      [pid, pid, pid],
    );
  }
}

describe("streamRunner audience propagation", () => {
  it("copies the prior user row's addressedTo into the assistant placeholder audience", async () => {
    handle = await createTestDb();
    await seedConversationAndPersonas();
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
      addressedTo: ["p_a", "p_b"],
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
      target: target("p_a"),
      personas: [],
      history: [userMsg],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
    });
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.audience).toEqual(["p_a", "p_b"]);
  });

  it("writes an empty audience when the prior user row was implicit", async () => {
    handle = await createTestDb();
    await seedConversationAndPersonas();
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
    const outcome = await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target("p_a"),
      personas: [],
      history: [userMsg],
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
    });
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.audience).toEqual([]);
  });
});
