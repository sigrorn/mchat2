// Builder drops role='notice' rows — issue #8.
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, PersonaTarget } from "@/lib/types";

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

describe("context builder: notice exclusion", () => {
  it("skips role='notice' rows so UI-only errors never reach the LLM", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "notice",
        content: "limit: 'foo' is not a valid message number.",
        index: 1,
      }),
      makeMessage({ conversationId: "c_1", role: "user", content: "again", index: 2 }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target(),
      messages,
      personas: [],
    });
    // #213: notice row is skipped, leaving two adjacent user-role
    // entries which collapse into one.
    expect(r.messages.map((m) => m.content)).toEqual(["hi\n\nagain"]);
  });
});
