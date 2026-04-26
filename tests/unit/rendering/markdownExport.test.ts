// Markdown export — issue #56.
import { describe, it, expect } from "vitest";
import { exportToMarkdown } from "@/lib/rendering/markdownExport";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, Persona } from "@/lib/types";

const conv: Conversation = {
  id: "c_1",
  title: "Test chat",
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

function persona(id: string, name: string): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "claude",
    name,
    nameSlug: name.toLowerCase(),
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null,
  };
}

describe("exportToMarkdown", () => {
  it("includes persona name but NOT provider or model", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [
        makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
        makeMessage({
          conversationId: "c_1",
          role: "assistant",
          content: "hello",
          provider: "claude",
          model: "claude-sonnet-4-6",
          personaId: "p_a",
          index: 1,
        }),
      ],
      personas: [persona("p_a", "claudio")],
      knownSecrets: [],
    });
    expect(md).toContain("claudio");
    expect(md).not.toContain("claude-sonnet-4-6");
    expect(md).not.toMatch(/\bclaude\b/i); // provider id leaked
  });

  it("renders user rows with [N] and targets", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "user",
          content: "hello all",
          index: 0,
          addressedTo: [],
        }),
      ],
      personas: [],
      knownSecrets: [],
    });
    expect(md).toContain("[1] user");
    expect(md).toContain("@all");
  });

  it("omits notice rows", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "notice" as "user",
          content: "imported 5 personas.",
          index: 0,
        }),
        makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 1 }),
      ],
      personas: [],
      knownSecrets: [],
    });
    expect(md).not.toContain("imported 5 personas");
  });

  it("includes error text for failed assistant rows", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [
        makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
        makeMessage({
          conversationId: "c_1",
          role: "assistant",
          content: "",
          provider: "gemini",
          personaId: "p_g",
          index: 1,
          errorMessage: "HTTP 503",
        }),
      ],
      personas: [persona("p_g", "gemma")],
      knownSecrets: [],
    });
    expect(md).toContain("gemma");
    expect(md).toContain("HTTP 503");
    expect(md).not.toContain("gemini"); // no provider leakage
  });

  it("marks pinned rows", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "user",
          content: "be brief",
          index: 0,
          pinned: true,
        }),
      ],
      personas: [],
      knownSecrets: [],
    });
    expect(md).toContain("📌");
  });

  it("redacts known secrets", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "user",
          content: "my key is sk-secret123456",
          index: 0,
        }),
      ],
      personas: [],
      knownSecrets: ["sk-secret123456"],
    });
    expect(md).not.toContain("sk-secret123456");
  });

  it("starts with a title heading", () => {
    const md = exportToMarkdown({
      conversation: conv,
      messages: [],
      personas: [],
      knownSecrets: [],
    });
    expect(md.startsWith("# Test chat")).toBe(true);
  });
});
