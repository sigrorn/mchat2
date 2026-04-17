import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, Persona, PersonaTarget } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: "global",
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
};

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: "p_alice",
    conversationId: "c_1",
    provider: "mock",
    name: "Alice",
    nameSlug: "alice",
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: null,
    deletedAt: null,
    apertusProductId: null,
    ...over,
  };
}

function target(key = "p_alice", personaId: string | null = "p_alice"): PersonaTarget {
  return { provider: "mock", personaId, key, displayName: "Alice" };
}

describe("buildContext", () => {
  it("uses persona systemPromptOverride if set, else conversation prompt", () => {
    // Persona targets always carry a 'You are {name}' identity line in
    // the system prompt (#39); the local layer (override or conversation
    // prompt) follows it, joined by a blank line.
    const identity =
      "You are Alice. Only respond as yourself \u2014 do not include or generate responses for other personas.";
    const personas = [persona({ systemPromptOverride: "alice says hi" })];
    const r = buildContext({ conversation: CONV, target: target(), messages: [], personas });
    expect(r.systemPrompt).toBe(`${identity}\n\nalice says hi`);

    const r2 = buildContext({
      conversation: CONV,
      target: target(),
      messages: [],
      personas: [persona({ systemPromptOverride: null })],
    });
    expect(r2.systemPrompt).toBe(`${identity}\n\nglobal`);
  });

  it("excludes failed assistant rows (rule 2)", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "partial",
        provider: "mock",
        personaId: "p_alice",
        index: 1,
        errorMessage: "boom",
        errorTransient: true,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target(),
      messages,
      personas: [persona()],
    });
    expect(r.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("applies limitMarkIndex but keeps pinned (rule 3)", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "old", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "pin-old",
        index: 1,
        pinned: true,
      }),
      makeMessage({ conversationId: "c_1", role: "user", content: "new", index: 3 }),
    ];
    const r = buildContext({
      conversation: { ...CONV, limitMarkIndex: 2 },
      target: target(),
      messages,
      personas: [persona()],
    });
    expect(r.messages.map((m) => m.content)).toEqual(["pin-old", "new"]);
  });

  it("applies persona cutoff (rule 4)", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "before", index: 0 }),
      makeMessage({ conversationId: "c_1", role: "user", content: "after", index: 3 }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target(),
      messages,
      personas: [persona({ createdAtMessageIndex: 2 })],
    });
    expect(r.messages.map((m) => m.content)).toEqual(["after"]);
  });

  it("honors pinTarget (rule 5)", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "for bob",
        index: 0,
        pinned: true,
        pinTarget: "p_bob",
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "for all",
        index: 1,
        pinned: true,
        pinTarget: null,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target(),
      messages,
      personas: [persona()],
    });
    expect(r.messages.map((m) => m.content)).toEqual(["for all"]);
  });

  it("drops user rows not addressed to this persona (rule 6)", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "to bob",
        index: 0,
        addressedTo: ["p_bob"],
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "to alice",
        index: 1,
        addressedTo: ["p_alice"],
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target(),
      messages,
      personas: [persona()],
    });
    expect(r.messages.map((m) => m.content)).toEqual(["to alice"]);
  });

  it("separated visibility hides other personas' assistant rows (rule 7)", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "alice says",
        provider: "mock",
        personaId: "p_alice",
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "bob says",
        provider: "mock",
        personaId: "p_bob",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target(),
      messages,
      personas: [persona()],
    });
    expect(r.messages.map((m) => m.content)).toEqual(["alice says"]);
  });

  it("joined visibility keeps all assistant rows", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a",
        provider: "mock",
        personaId: "p_alice",
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "b",
        provider: "mock",
        personaId: "p_bob",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: { ...CONV, visibilityMode: "joined" },
      target: target(),
      messages,
      personas: [persona()],
    });
    expect(r.messages.map((m) => m.content)).toEqual(["a", "b"]);
  });
});
