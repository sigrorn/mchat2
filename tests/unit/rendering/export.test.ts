import { describe, it, expect } from "vitest";
import { exportToHtml, exportToJson } from "@/lib/rendering";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "My chat",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitSizeTokens: null,
};

describe("exportToHtml", () => {
  it("redacts known secrets and generic keys", () => {
    const html = exportToHtml({
      conversation: CONV,
      personas: [],
      generatedAt: "2026-04-15",
      knownSecrets: ["myPersonalToken123"],
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "user",
          content: "Here is my key sk-abcdefghijklmnopqrstuvwxyz and my token myPersonalToken123",
        }),
      ],
    });
    expect(html).toContain("[REDACTED]");
    expect(html).not.toContain("sk-abc");
    expect(html).not.toContain("myPersonalToken123");
    expect(html).toContain("<title>My chat</title>");
  });
});

describe("exportToJson", () => {
  it("produces v1 payload with redacted content", () => {
    const json = exportToJson({
      conversation: CONV,
      personas: [],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "assistant",
          content: "key sk-abcdefghijklmnopqrstuvwxyz",
          provider: "mock",
        }),
      ],
    });
    const parsed = JSON.parse(json) as { version: number; messages: { content: string }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.messages[0]?.content).toContain("[REDACTED]");
  });
});
