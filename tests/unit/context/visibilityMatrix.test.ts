// Visibility matrix filtering in buildContext — issue #52, #75.
import { describe, it, expect } from "vitest";
import { buildContext } from "@/lib/context";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, Persona, PersonaTarget } from "@/lib/types";

function persona(id: string, name: string): Persona {
  return {
    id,
    conversationId: "c_1",
    provider: "mock",
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
  };
}

function target(personaId: string): PersonaTarget {
  return { provider: "mock", personaId, key: personaId, displayName: personaId };
}

const BASE: Conversation = {
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

describe("buildContext with visibilityMatrix (#75)", () => {
  const personas = [persona("p_a", "A"), persona("p_b", "B"), persona("p_c", "C")];
  const messages = [
    makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
    makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "from A",
      provider: "mock",
      personaId: "p_a",
      index: 1,
    }),
    makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "from B",
      provider: "mock",
      personaId: "p_b",
      index: 2,
    }),
    makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "from C",
      provider: "mock",
      personaId: "p_c",
      index: 3,
    }),
  ];

  it("empty matrix = full visibility (everyone sees everyone) (#75)", () => {
    const r = buildContext({
      conversation: { ...BASE, visibilityMatrix: {} },
      target: target("p_a"),
      messages,
      personas,
    });
    // #73: user message reordered to end.
    expect(r.messages.map((m) => m.content)).toEqual(["from A", "from B", "from C", "hi"]);
  });

  it("separated preset: each persona has [] → sees only self", () => {
    const r = buildContext({
      conversation: {
        ...BASE,
        visibilityMatrix: { p_a: [], p_b: [], p_c: [] },
      },
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["hi", "from A"]);
  });

  it("matrix allows p_a to see p_b but not p_c", () => {
    const r = buildContext({
      conversation: { ...BASE, visibilityMatrix: { p_a: ["p_b"], p_b: [], p_c: [] } },
      target: target("p_a"),
      messages,
      personas,
    });
    // #73: user message reordered to end when 2+ assistants follow.
    expect(r.messages.map((m) => m.content)).toEqual(["from A", "from B", "hi"]);
  });

  it("asymmetric: alice sees bob but bob doesn't see alice", () => {
    const r1 = buildContext({
      conversation: {
        ...BASE,
        visibilityMatrix: { p_a: ["p_b"], p_b: [] },
      },
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r1.messages.map((m) => m.content)).toEqual(["from A", "from B", "hi"]);

    const r2 = buildContext({
      conversation: {
        ...BASE,
        visibilityMatrix: { p_a: ["p_b"], p_b: [] },
      },
      target: target("p_b"),
      messages,
      personas,
    });
    expect(r2.messages.map((m) => m.content)).toEqual(["hi", "from B"]);
  });

  it("persona missing from matrix → full visibility (sees everyone)", () => {
    const r = buildContext({
      conversation: {
        ...BASE,
        visibilityMatrix: { p_b: [] },
      },
      target: target("p_a"),
      messages,
      personas,
    });
    // p_a not in matrix → sees everyone.
    expect(r.messages.map((m) => m.content)).toEqual(["from A", "from B", "from C", "hi"]);
  });

  it("visibilityMode is ignored — matrix is sole source of truth (#75)", () => {
    const r = buildContext({
      conversation: {
        ...BASE,
        visibilityMode: "separated",
        visibilityMatrix: {},
      },
      target: target("p_a"),
      messages,
      personas,
    });
    // Empty matrix = full, regardless of visibilityMode.
    expect(r.messages.map((m) => m.content)).toEqual(["from A", "from B", "from C", "hi"]);
  });
});
