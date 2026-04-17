// Audience-based visibility in context builder — issue #4.
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, Persona, PersonaTarget } from "@/lib/types";

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
};

function persona(id: string): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "claude",
    name: id,
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
  };
}

function target(key: string): PersonaTarget {
  return { provider: "claude", personaId: key, key, displayName: key };
}

describe("context builder — audience-based visibility", () => {
  it("in separated mode, persona sees co-audience responses even from other personas", () => {
    const personas = [persona("p_claudio"), persona("p_gepetto")];
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "hello",
        addressedTo: ["p_claudio", "p_gepetto"],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "claudio says hi",
        provider: "claude",
        personaId: "p_claudio",
        audience: ["p_claudio", "p_gepetto"],
        index: 1,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "gepetto says hi",
        provider: "claude",
        personaId: "p_gepetto",
        audience: ["p_claudio", "p_gepetto"],
        index: 2,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_claudio"),
      messages,
      personas,
    });
    // #73: user message reordered to end when 2+ assistants follow.
    expect(r.messages.map((m) => m.content)).toEqual([
      "claudio says hi",
      "gepetto says hi",
      "hello",
    ]);
  });

  it("in separated mode, persona NOT in audience does not see the row", () => {
    const personas = [persona("p_claudio"), persona("p_gepetto"), persona("p_mario")];
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "just you two",
        addressedTo: ["p_claudio", "p_gepetto"],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "for the pair",
        provider: "claude",
        personaId: "p_claudio",
        audience: ["p_claudio", "p_gepetto"],
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_mario"),
      messages,
      personas,
    });
    expect(r.messages).toEqual([]);
  });

  it("legacy rows with empty audience fall back to author-only filter", () => {
    // Pre-migration assistant rows have audience=[] and must keep the
    // old behavior: persona sees only its own authored rows, not other
    // personas' rows. This prevents a sudden leak across conversations
    // that predate the audience column.
    const personas = [persona("p_a"), persona("p_b")];
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a speaks",
        provider: "claude",
        personaId: "p_a",
        audience: [],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "b speaks",
        provider: "claude",
        personaId: "p_b",
        audience: [],
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["a speaks"]);
  });

  it("joined mode is unaffected (both audience and non-audience rows visible)", () => {
    const personas = [persona("p_a"), persona("p_b")];
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a",
        provider: "claude",
        personaId: "p_a",
        audience: ["p_b"],
        index: 0,
      }),
    ];
    const r = buildContext({
      conversation: { ...CONV, visibilityMode: "joined" },
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["a"]);
  });
});
