// //stats formatter tests — issues #116, #119.
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
  overrides: Partial<Message> = {},
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
    ...overrides,
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

  it("starts with the chat-stats heading", () => {
    expect(formatStats(CONV, [], [persona("p1", "claudio", "claude")])).toMatch(/^##\s+Chat stats/);
  });

  // #122: drop the conversation title suffix; keep just "## Chat stats".
  it("heading is just 'Chat stats' (no conversation title suffix)", () => {
    const out = formatStats(CONV, [], [persona("p1", "claudio", "claude")]);
    const first = out.split("\n")[0] ?? "";
    expect(first.trim()).toBe("## Chat stats");
  });
});

describe("formatStats columns with timings (#122)", () => {
  it("includes avg TTFT and avg tok/s columns in the header", () => {
    const out = formatStats(CONV, [msg(0, "user", "hi")], [persona("p1", "claudio", "claude")]);
    expect(out).toMatch(/\|\s*avg TTFT\s*\|/i);
    expect(out).toMatch(/\|\s*avg tok\/s\s*\|/i);
  });

  it("persona row shows '—' for both timing columns when no data", () => {
    const out = formatStats(CONV, [msg(0, "user", "hi")], [persona("p1", "claudio", "claude")]);
    const claudioRow = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l));
    expect(claudioRow).toBeTruthy();
    // Expect at least two "—" cells in the row (one per timing column).
    const dashes = (claudioRow!.match(/—/g) ?? []).length;
    expect(dashes).toBeGreaterThanOrEqual(2);
  });
});

describe("formatStats as markdown table (#119)", () => {
  it("output contains a markdown table header with the four expected columns", () => {
    const messages = [msg(0, "user", "Hello")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    // Header row lists the columns.
    expect(out).toMatch(/\|\s*persona\s*\|\s*user messages\s*\|\s*tokens\s*\|\s*%\s+of max context\s*\|/i);
    // Separator row present.
    expect(out).toMatch(/\|\s*-+\s*\|.*\|.*\|.*\|/);
  });

  it("'all messages' row is present with tokens; user-messages and % cells are blank", () => {
    const messages = [msg(0, "user", "Hello"), msg(1, "assistant", "Hi", "p1")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    // Find the all messages row — should have a token count but no persona %.
    const allRow = out.split("\n").find((l) => /\|\s*all messages\s*\|/.test(l));
    expect(allRow).toBeTruthy();
    expect(allRow).not.toContain("%");
  });

  it("per-persona row includes a user-message count", () => {
    const messages = [
      msg(0, "user", "Hello"),
      msg(1, "assistant", "Hi", "p1"),
      msg(2, "user", "Another"),
      msg(3, "user", "Third"),
    ];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    // claudio row should contain the count 3 (three non-pinned user messages).
    const claudioRow = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l));
    expect(claudioRow).toBeTruthy();
    expect(claudioRow).toMatch(/\|\s*claudio\s*\|\s*3\s*\|/);
  });

  it("user-message count excludes pinned messages and messages below compactionFloor", () => {
    const pinnedIdentity = msg(0, "user", "identity", null, { pinned: true });
    const messages = [
      pinnedIdentity,
      msg(1, "user", "before floor"),
      msg(2, "user", "after floor 1"),
      msg(3, "user", "after floor 2"),
    ];
    const conv = { ...CONV, compactionFloorIndex: 2 };
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(conv, messages, personas);
    // Only msgs 2 and 3 count (pinned excluded; msg 1 below floor).
    const claudioRow = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l));
    expect(claudioRow).toMatch(/\|\s*claudio\s*\|\s*2\s*\|/);
  });

  it("per-persona row includes percentage of max context", () => {
    const messages = [msg(0, "user", "Hello")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    const claudioRow = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l));
    expect(claudioRow).toMatch(/\d+(\.\d+)?%/);
  });
});

describe("formatStats cumulative in/out tokens (#132)", () => {
  it("header includes 'in tokens' and 'out tokens' columns", () => {
    const out = formatStats(CONV, [], [persona("p1", "claudio", "claude")]);
    expect(out).toMatch(/\|\s*in tokens\s*\|/i);
    expect(out).toMatch(/\|\s*out tokens\s*\|/i);
  });

  it("sums inputTokens and outputTokens on the persona's assistant rows", () => {
    const messages = [
      msg(0, "user", "hi"),
      msg(1, "assistant", "hello", "p1", { inputTokens: 100, outputTokens: 20 }),
      msg(2, "user", "again"),
      msg(3, "assistant", "there", "p1", { inputTokens: 150, outputTokens: 30 }),
    ];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    const row = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l))!;
    // 100 + 150 = 250 in, 20 + 30 = 50 out.
    expect(row).toMatch(/\|\s*250\s*\|\s*50\s*\|/);
  });

  it("excludes rows below compactionFloorIndex", () => {
    const messages = [
      msg(0, "user", "pre-compact"),
      msg(1, "assistant", "pre", "p1", { inputTokens: 99, outputTokens: 99 }),
      msg(2, "user", "post"),
      msg(3, "assistant", "post-reply", "p1", { inputTokens: 7, outputTokens: 3 }),
    ];
    const conv = { ...CONV, compactionFloorIndex: 2 };
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(conv, messages, personas);
    const row = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l))!;
    // Only msg 3 counts.
    expect(row).toMatch(/\|\s*7\s*\|\s*3\s*\|/);
    expect(row).not.toMatch(/99/);
  });

  it("excludes assistant rows belonging to other personas", () => {
    const messages = [
      msg(0, "user", "hi"),
      msg(1, "assistant", "from p1", "p1", { inputTokens: 10, outputTokens: 20 }),
      msg(2, "assistant", "from p2", "p2", { inputTokens: 777, outputTokens: 888 }),
    ];
    const personas = [persona("p1", "claudio", "claude"), persona("p2", "misty", "openai")];
    const out = formatStats(CONV, messages, personas);
    const claudio = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l))!;
    const misty = out.split("\n").find((l) => /\|\s*misty\s*\|/.test(l))!;
    expect(claudio).toMatch(/\|\s*10\s*\|\s*20\s*\|/);
    expect(misty).toMatch(/\|\s*777\s*\|\s*888\s*\|/);
  });

  it("shows 0 when no usage has been recorded", () => {
    const messages = [msg(0, "user", "hi")];
    const personas = [persona("p1", "claudio", "claude")];
    const out = formatStats(CONV, messages, personas);
    const row = out.split("\n").find((l) => /\|\s*claudio\s*\|/.test(l))!;
    expect(row).toMatch(/\|\s*0\s*\|\s*0\s*\|/);
  });

  it("renames the context-size column to 'context tokens'", () => {
    const out = formatStats(CONV, [], [persona("p1", "claudio", "claude")]);
    expect(out).toMatch(/\|\s*context tokens\s*\|/i);
  });
});
