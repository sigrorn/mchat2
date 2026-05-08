// #180 — buildContext should drop assistant rows whose ids appear in
// the supersededIds set, so retry/replay flows that no longer delete
// the old rows don't poison the next attempt with stale context.
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context/builder";
import type { Conversation, Message, Persona } from "@/lib/types";

function makeConv(): Conversation {
  return {
    id: "c1",
    title: "t",
    systemPrompt: null,
    createdAt: 0,
    lastProvider: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  };
}

function makePersona(): Persona {
  return {
    id: "p1",
    conversationId: "c1",
    provider: "mock",
    name: "Mock",
    nameSlug: "mock",
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null, roleLens: {},
  };
}

function userMsg(id: string, idx: number, content: string): Message {
  return {
    id,
    conversationId: "c1",
    role: "user",
    content,
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: idx,
    index: idx,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
    ttftMs: null,
    streamMs: null,
  };
}

function assistantMsg(
  id: string,
  idx: number,
  content: string,
  errorMessage: string | null = null,
): Message {
  return {
    id,
    conversationId: "c1",
    role: "assistant",
    content,
    provider: "mock",
    model: "mock",
    personaId: "p1",
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: idx,
    index: idx,
    errorMessage,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
    ttftMs: null,
    streamMs: null,
  };
}

describe("buildContext supersededIds filter (#180)", () => {
  const conv = makeConv();
  const persona = makePersona();
  const target = { key: "mock", personaId: "p1", provider: "mock" as const, displayName: "Mock" };

  it("includes assistant rows whose ids are not in supersededIds (default)", () => {
    const messages = [userMsg("u1", 1, "hi"), assistantMsg("a1", 2, "hello")];
    const result = buildContext({
      conversation: conv,
      target,
      messages,
      personas: [persona],
    });
    expect(result.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
  });

  it("excludes assistant rows whose ids appear in supersededIds", () => {
    const messages = [
      userMsg("u1", 1, "hi"),
      assistantMsg("a1", 2, "old-superseded"),
      assistantMsg("a2", 3, "new-attempt"),
    ];
    const result = buildContext({
      conversation: conv,
      target,
      messages,
      personas: [persona],
      supersededIds: new Set(["a1"]),
    });
    expect(result.messages.map((m) => m.content)).toEqual(["hi", "new-attempt"]);
  });

  it("does not affect user rows even if their id is in the set", () => {
    // Sanity: only assistant rows are considered superseded; user
    // rows pass through regardless.
    const messages = [userMsg("u1", 1, "hi"), assistantMsg("a1", 2, "reply")];
    const result = buildContext({
      conversation: conv,
      target,
      messages,
      personas: [persona],
      supersededIds: new Set(["u1"]),
    });
    expect(result.messages.map((m) => m.content)).toEqual(["hi", "reply"]);
  });

  // #294 — hiddenByResetId rows must not enter context regardless of role.
  // Same shape as supersededAt's role in #180: the row stays in the DB so
  // a future export can resurface it with its color group; meanwhile the
  // LLM sees a clean rollback.
  it("excludes rows whose hiddenByResetId is non-null", () => {
    const u1 = userMsg("u1", 1, "kept-user");
    const a1 = assistantMsg("a1", 2, "kept-asst");
    const u2 = { ...userMsg("u2", 3, "hidden-user"), hiddenByResetId: 1 };
    const a2 = { ...assistantMsg("a2", 4, "hidden-asst"), hiddenByResetId: 1 };
    const result = buildContext({
      conversation: conv,
      target,
      messages: [u1, a1, u2, a2],
      personas: [persona],
    });
    expect(result.messages.map((m) => m.content)).toEqual(["kept-user", "kept-asst"]);
  });
});
