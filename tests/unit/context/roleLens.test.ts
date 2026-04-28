// buildContext role-lens projection + normalization — slice 1 of #212 (#213).
//
// Persona.roleLens maps a source-speaker key (a persona-id or the literal
// "user") to "user" | "assistant". When set, buildContext projects the
// matching message's role accordingly. The speaker-identity rule:
// persona speakers projected to user-role keep their "<name>: " prefix
// in content; the human user's own messages stay raw (no prefix).
//
// Anthropic 400s on consecutive same-role messages, so after lens
// application a normalization pass collapses runs of same-role entries
// into one — content joined with "\n\n", name-prefixes preserved.
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
  visibilityMode: "joined",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

function persona(id: string, name: string, roleLens: Persona["roleLens"] = {}): Persona {
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
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens,
  };
}

function target(id: string, name: string): PersonaTarget {
  return { provider: "mock", personaId: id, key: id, displayName: name };
}

describe("buildContext role lens (#213)", () => {
  it("empty lens preserves today's role mapping bit-for-bit", () => {
    // Pin the no-lens behavior so the refactor doesn't drift.
    const personas = [persona("p_a", "alice"), persona("p_b", "bob")];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "hi back",
        provider: "mock",
        personaId: "p_b",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    expect(r.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "bob: hi back" },
    ]);
  });

  it("remaps a single source persona to user-role and preserves the name prefix", () => {
    // Coach (alice) sees opponent (bob) as user-role, keeping bob's
    // identity in the content.
    const personas = [
      persona("p_a", "alice", { p_b: "user" }),
      persona("p_b", "bob"),
    ];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "let's argue", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "you're wrong",
        provider: "mock",
        personaId: "p_b",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    // After lens: bob's reply becomes user-role with "bob: " prefix
    // preserved. The original user message + the bob entry are now
    // both user-role and adjacent — normalization collapses them.
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.role).toBe("user");
    expect(r.messages[0]!.content).toContain("let's argue");
    expect(r.messages[0]!.content).toContain("bob: you're wrong");
  });

  it("remaps multiple source speakers to user-role", () => {
    // Coach (alice) treats both the human user and bob as user-role.
    const personas = [
      persona("p_a", "alice", { user: "user", p_b: "user" }),
      persona("p_b", "bob"),
      persona("p_c", "carol"),
    ];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "u1", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "b1",
        provider: "mock",
        personaId: "p_b",
        index: 1,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "c1",
        provider: "mock",
        personaId: "p_c",
        index: 2,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    // user-role: u1, "bob: b1" — collapsed into one user entry.
    // assistant-role: "carol: c1" — left alone (no override for carol).
    // Result has alternating roles after collapse: ['user', 'assistant'].
    expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(r.messages[0]!.content).toContain("u1");
    expect(r.messages[0]!.content).toContain("bob: b1");
    expect(r.messages[1]!.content).toBe("carol: c1");
  });

  it("preserves the persona prefix through projection AND normalization", () => {
    // Both bob and carol projected to user; their entries collapse
    // but each line keeps its "<name>: " prefix.
    const personas = [
      persona("p_a", "alice", { p_b: "user", p_c: "user" }),
      persona("p_b", "bob"),
      persona("p_c", "carol"),
    ];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "trigger", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "from bob",
        provider: "mock",
        personaId: "p_b",
        index: 1,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "from carol",
        provider: "mock",
        personaId: "p_c",
        index: 2,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    // All three become user-role and collapse.
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]!.role).toBe("user");
    expect(r.messages[0]!.content).toContain("trigger");
    expect(r.messages[0]!.content).toContain("bob: from bob");
    expect(r.messages[0]!.content).toContain("carol: from carol");
  });

  it("the human user's own messages stay raw — no '<name>: ' prefix", () => {
    // Even when projected (no-op since user is already user-role), the
    // user message itself never gains a prefix. This is the
    // speaker-identity rule for the human speaker.
    const personas = [persona("p_a", "alice", { user: "user" })];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hello", index: 0 }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    expect(r.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("collapses consecutive same-role entries that would otherwise 400 on Anthropic", () => {
    // No lens — but joined visibility lets alice see two prior
    // assistant replies. Pre-#213, builder.ts had an ad-hoc trailing-
    // user shuffle for this. Post-#213, normalization collapses runs
    // generally; trailing-user shuffle still composes on top.
    const personas = [
      persona("p_a", "alice"),
      persona("p_b", "bob"),
      persona("p_c", "carol"),
    ];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "u", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "b1",
        provider: "mock",
        personaId: "p_b",
        index: 1,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "c1",
        provider: "mock",
        personaId: "p_c",
        index: 2,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    // Roles must alternate. Two assistant replies collapse into one
    // entry whose content carries both prefixed lines.
    const roles = r.messages.map((m) => m.role);
    for (let i = 1; i < roles.length; i++) {
      expect(roles[i]).not.toBe(roles[i - 1]);
    }
    const collapsed = r.messages.find(
      (m) => m.role === "assistant" && m.content.includes("bob:") && m.content.includes("carol:"),
    );
    expect(collapsed).toBeDefined();
  });

  it("does not project the active target's own messages (target is always assistant-of-self)", () => {
    // alice's lens has no entry for herself; her own messages stay
    // assistant-role with no prefix (existing rule). Pin: an entry like
    // { p_a: "user" } is the target trying to override its own role —
    // that's a meaningless config, the projector ignores it.
    const personas = [persona("p_a", "alice", { p_a: "user" })];
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "from me",
        provider: "mock",
        personaId: "p_a",
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: target("p_a", "alice"),
      messages,
      personas,
    });
    expect(r.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "from me" },
    ]);
  });
});
