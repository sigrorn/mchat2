// Visibility matrix filtering in buildContext — issue #52.
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
    runsAfter: null,
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

describe("buildContext with visibilityMatrix", () => {
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

  it("empty matrix → default separated behaviour (observer sees only self)", () => {
    const r = buildContext({
      conversation: BASE,
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["hi", "from A"]);
  });

  it("matrix allows p_a to see p_b but not p_c", () => {
    const r = buildContext({
      conversation: { ...BASE, visibilityMatrix: { p_a: ["p_b"] } },
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["hi", "from A", "from B"]);
  });

  it("empty array in matrix → fully isolated (same as separated with no override)", () => {
    const r = buildContext({
      conversation: { ...BASE, visibilityMatrix: { p_a: [] } },
      target: target("p_a"),
      messages,
      personas,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["hi", "from A"]);
  });

  it("matrix on joined conversation: observer still gets restricted", () => {
    const r = buildContext({
      conversation: {
        ...BASE,
        visibilityMode: "joined",
        visibilityMatrix: { p_a: ["p_b"] },
      },
      target: target("p_a"),
      messages,
      personas,
    });
    // Joined would normally show all three; matrix restricts to self + p_b.
    expect(r.messages.map((m) => m.content)).toEqual(["hi", "from A", "from B"]);
  });

  it("observer not in matrix with joined → full visibility", () => {
    const r = buildContext({
      conversation: {
        ...BASE,
        visibilityMode: "joined",
        visibilityMatrix: { p_b: [] },
      },
      target: target("p_a"),
      messages,
      personas,
    });
    // p_a not in matrix → joined default → sees everyone.
    expect(r.messages.map((m) => m.content)).toEqual(["hi", "from A", "from B", "from C"]);
  });
});
