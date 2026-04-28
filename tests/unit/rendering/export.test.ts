import { describe, it, expect } from "vitest";
import { exportToHtml, exportToJson } from "@/lib/rendering";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, Persona } from "@/lib/types";

const persona = (overrides: Partial<Persona> & { id: string; name: string }): Persona => ({
  conversationId: "c_1",
  provider: "mock",
  nameSlug: overrides.name.toLowerCase(),
  systemPromptOverride: null,
  modelOverride: null,
  colorOverride: null,
  createdAtMessageIndex: 0,
  sortOrder: 0,
  runsAfter: [],
  deletedAt: null,
  apertusProductId: null,
  visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  ...overrides,
});

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
  selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
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

  it("user message header includes addressedTo persona name", () => {
    const claudio = persona({ id: "p_claudio", name: "Claudio" });
    const html = exportToHtml({
      conversation: CONV,
      personas: [claudio],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "user",
          content: "hello",
          addressedTo: ["p_claudio"],
        }),
      ],
    });
    // Arrow + @name like the in-app chat header.
    expect(html).toMatch(/user\s*→\s*@Claudio/);
  });

  it("user message addressed to no one shows '@all'", () => {
    const html = exportToHtml({
      conversation: CONV,
      personas: [persona({ id: "p1", name: "A" }), persona({ id: "p2", name: "B" })],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [
        makeMessage({ conversationId: "c_1", role: "user", content: "hi", addressedTo: [] }),
      ],
    });
    expect(html).toMatch(/user\s*→\s*@all/);
  });

  it("user message with pinTarget renders the target persona's name", () => {
    const html = exportToHtml({
      conversation: CONV,
      personas: [persona({ id: "p_x", name: "Xenia" })],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [
        makeMessage({
          conversationId: "c_1",
          role: "user",
          content: "pinned",
          pinTarget: "p_x",
          addressedTo: [],
        }),
      ],
    });
    expect(html).toMatch(/user\s*→\s*@Xenia/);
  });

  it("renders a Personas section listing each persona's effective system prompt", () => {
    const a = persona({ id: "p_a", name: "Alpha", systemPromptOverride: "alpha-override-prompt" });
    const b = persona({ id: "p_b", name: "Beta", systemPromptOverride: null });
    const conv: Conversation = { ...CONV, systemPrompt: "global-prompt-text" };
    const html = exportToHtml({
      conversation: conv,
      personas: [a, b],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [],
    });
    expect(html).toContain("Personas");
    expect(html).toContain("Alpha");
    expect(html).toContain("alpha-override-prompt");
    // Beta has no override → falls back to the conversation-level prompt.
    expect(html).toContain("Beta");
    expect(html).toContain("global-prompt-text");
  });

  it("Personas section is omitted when there are no personas", () => {
    const html = exportToHtml({
      conversation: CONV,
      personas: [],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [],
    });
    expect(html).not.toContain("Personas");
  });

  it("escapes HTML in persona name and system prompt", () => {
    const evil = persona({
      id: "p_x",
      name: "<script>alert('x')</script>",
      systemPromptOverride: "<img src=x onerror=alert(1)>",
    });
    const html = exportToHtml({
      conversation: CONV,
      personas: [evil],
      generatedAt: "2026-04-15",
      knownSecrets: [],
      messages: [],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("redacts secrets in persona system prompts", () => {
    const p = persona({
      id: "p_a",
      name: "A",
      systemPromptOverride: "Use my token myPersonalToken123",
    });
    const html = exportToHtml({
      conversation: CONV,
      personas: [p],
      generatedAt: "2026-04-15",
      knownSecrets: ["myPersonalToken123"],
      messages: [],
    });
    expect(html).not.toContain("myPersonalToken123");
    expect(html).toContain("[REDACTED]");
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
