// //stats formatter tests — issue #116.
import { describe, it, expect } from "vitest";
import { formatStats } from "@/lib/commands/stats";
import type { Conversation, Message, Persona } from "@/lib/types";

const CONV: Conversation = {
  id: "c1",
  title: "Test chat",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "joined",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

function persona(id: string, name: string, provider: "openai" | "claude"): Persona {
  return {
    id,
    conversationId: "c1",
    provider,
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
    visibilityDefaults: {},
  };
}

function msg(
  index: number,
  role: "user" | "assistant",
  content: string,
  personaId: string | null = null,
): Message {
  return {
    id: `m${index}`,
    conversationId: "c1",
    role,
    content,
    provider: personaId ? "openai" : null,
    model: personaId ? "gpt-4o" : null,
    personaId,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: index * 1000,
    index,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
  };
}

describe("formatStats (#116)", () => {
  it("no personas → stats: no personas", () => {
    expect(formatStats(CONV, [], [])).toBe("stats: no personas.");
  });

  it("does not include '(~ chars)' on any line", () => {
    const messages = [msg(0, "user", "Hello"), msg(1, "assistant", "Hi there", "p1")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    expect(out).not.toMatch(/~\s*\d+\s*chars/);
    expect(out).not.toContain("chars)");
  });

  it("per-persona lines include a '% of max context' column", () => {
    const messages = [msg(0, "user", "Hello"), msg(1, "assistant", "Hi there", "p1")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    // The persona line should contain a percentage like "0.00%".
    expect(out).toMatch(/claudio\s+\d[\d,]*\s+tokens\s+\(\d+(\.\d+)?%\s+of\s+max\s+context\)/);
  });

  it("'all messages' line has no percentage", () => {
    const messages = [msg(0, "user", "Hello"), msg(1, "assistant", "Hi", "p1")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    // The all-messages line should not contain the "max context" phrase.
    const firstLine = out.split("\n").find((l) => l.includes("all messages"));
    expect(firstLine).toBeTruthy();
    expect(firstLine).not.toContain("max context");
  });

  it("starts with the chat-stats heading", () => {
    expect(formatStats(CONV, [], [persona("p1", "claudio", "claude")])).toMatch(/^Chat stats/);
  });
});
