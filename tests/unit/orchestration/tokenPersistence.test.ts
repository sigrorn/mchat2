// streamRunner persists token counts on completion — issue #2.
// #200: rewritten to round-trip through sql.js instead of asserting on
// UPDATE messages SET input_tokens parameter positions.
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

function target(): PersonaTarget {
  return { provider: "mock", personaId: null, key: "mock", displayName: "Mock" };
}

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("streamRunner token persistence", () => {
  it("writes input/output token counts and the estimated flag on finalize", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_1', 'T', 0, 'lines', 'separated', '{}', '[]', '[]')`,
    );
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
    });
    const placeholder = await messagesRepo.getMessage(outcome.messageId);
    expect(placeholder?.inputTokens).toBeGreaterThan(0);
    expect(placeholder?.outputTokens).toBeGreaterThan(0);
    expect(placeholder?.usageEstimated).toBe(true);
  });
});
