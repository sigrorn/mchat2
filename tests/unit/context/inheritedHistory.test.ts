// Persona scope="inherit" — issue #260.
//
// "inherit" was supposed to give a late-joining persona access to the
// pre-existing conversation. Pre-fix it only set
// createdAtMessageIndex=0 (relaxing the cutoff filter), but the
// addressedTo (user rows) and audience (assistant rows) filters still
// bit — so a new persona added to a conversation full of @-targeted
// messages saw nothing.
//
// The fix introduces a `inheritedHistory` flag on Persona. When true,
// pre-creation messages are exempt from addressedTo / audience filters
// — the persona "wasn't around to be addressed," so we don't filter on
// who was. Visibility matrix and pin-target rules still apply (those
// are deliberate gating, not routing residue).
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

function persona(args: {
  id: string;
  createdAt: number;
  inherits?: boolean;
}): Persona {
  return {
    id: args.id,
    conversationId: "c_1",
    provider: "claude",
    name: args.id,
    nameSlug: args.id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: args.createdAt,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
    inheritedHistory: args.inherits ?? false,
  };
}

function targetFor(p: Persona): PersonaTarget {
  return { provider: "claude", personaId: p.id, key: p.id, displayName: p.name };
}

describe("buildContext — persona.inheritedHistory (#260)", () => {
  it("late persona with inherit=true sees pre-creation user messages addressed to other personas", () => {
    // Conversation history: user @-addressed appi twice, appi answered
    // both times. Then kimi joined with scope=inherit and the user
    // sent a fresh prompt routed to kimi only. Pre-fix kimi's context
    // saw nothing but the new prompt; post-fix kimi sees the full
    // prior conversation.
    const appi = persona({ id: "p_appi", createdAt: 0 });
    const kimi = persona({ id: "p_kimi", createdAt: 4, inherits: true });
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "tell me about EATA",
        addressedTo: ["p_appi"],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "EATA is...",
        provider: "claude",
        personaId: "p_appi",
        audience: ["p_appi"],
        index: 1,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "expand on the labor angle",
        addressedTo: ["p_appi"],
        index: 2,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "labor angle is...",
        provider: "claude",
        personaId: "p_appi",
        audience: ["p_appi"],
        index: 3,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "please continue this reasoning",
        addressedTo: ["p_kimi"],
        index: 4,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: targetFor(kimi),
      messages,
      personas: [appi, kimi],
    });
    // Strip the system prompt entry, focus on conversation entries.
    const userTexts = r.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content);
    const assistantTexts = r.messages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);
    // The two earlier user prompts are visible despite addressedTo=[appi].
    expect(userTexts.some((c) => c.includes("tell me about EATA"))).toBe(true);
    expect(userTexts.some((c) => c.includes("expand on the labor angle"))).toBe(true);
    // Appi's two answers are visible despite audience=[appi]. They
    // arrive prefixed with the persona name (per the cross-persona
    // rendering rule).
    expect(assistantTexts.some((c) => c.includes("EATA is..."))).toBe(true);
    expect(assistantTexts.some((c) => c.includes("labor angle is..."))).toBe(true);
    // The new prompt is also visible (it's addressed to kimi).
    expect(userTexts.some((c) => c.includes("please continue this reasoning"))).toBe(true);
  });

  it("late persona with inherit=false (scope=new) does NOT see pre-creation messages — today's behaviour", () => {
    // Regression guard: scope=new must keep working. createdAtMessageIndex
    // gates pre-creation messages, addressedTo/audience filters apply
    // to anything that survives the cutoff. The test seeds the same
    // shape as above but with inherits=false; kimi should see only
    // the post-creation prompt.
    const appi = persona({ id: "p_appi", createdAt: 0 });
    const kimi = persona({ id: "p_kimi", createdAt: 4, inherits: false });
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "earlier prompt to appi",
        addressedTo: ["p_appi"],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "appi reply",
        provider: "claude",
        personaId: "p_appi",
        audience: ["p_appi"],
        index: 1,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "post-kimi prompt",
        addressedTo: ["p_kimi"],
        index: 4,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: targetFor(kimi),
      messages,
      personas: [appi, kimi],
    });
    const allText = r.messages.map((m) => m.content).join("\n");
    expect(allText).not.toContain("earlier prompt to appi");
    expect(allText).not.toContain("appi reply");
    expect(allText).toContain("post-kimi prompt");
  });

  it("inheriting persona still respects the visibility matrix on pre-creation messages", () => {
    // The matrix is a deliberate "I don't want this persona to see
    // this other persona's output" gate. Inheriting history must
    // not bypass it.
    const appi = persona({ id: "p_appi", createdAt: 0 });
    const kimi = persona({ id: "p_kimi", createdAt: 2, inherits: true });
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "user prompt",
        addressedTo: ["p_appi"],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "appi secret reply",
        provider: "claude",
        personaId: "p_appi",
        audience: ["p_appi"],
        index: 1,
      }),
    ];
    // Matrix: kimi can see only itself (excludes appi). Even with
    // inherit=true, this gate still bites.
    const conv: Conversation = {
      ...CONV,
      visibilityMatrix: { p_kimi: ["p_kimi"] },
    };
    const r = buildContext({
      conversation: conv,
      target: targetFor(kimi),
      messages,
      personas: [appi, kimi],
    });
    const allText = r.messages.map((m) => m.content).join("\n");
    // User row passes (no per-row visibility for user rows in matrix).
    expect(allText).toContain("user prompt");
    // Appi's reply blocked by matrix despite inherit.
    expect(allText).not.toContain("appi secret reply");
  });

  it("inheriting persona still drops messages with a pinTarget that names another persona", () => {
    // pinTarget is a deliberate "this pin is FOR persona X" mark; it
    // shouldn't leak via the inherit relaxation.
    const appi = persona({ id: "p_appi", createdAt: 0 });
    const kimi = persona({ id: "p_kimi", createdAt: 2, inherits: true });
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "private to appi",
        addressedTo: ["p_appi"],
        pinned: true,
        pinTarget: "p_appi",
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "shared prompt",
        addressedTo: ["p_appi"],
        index: 1,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: targetFor(kimi),
      messages,
      personas: [appi, kimi],
    });
    const allText = r.messages.map((m) => m.content).join("\n");
    // Pin-targeted to appi only — kimi never sees it.
    expect(allText).not.toContain("private to appi");
    // Shared prompt is normally @appi-routed but kimi inherits → visible.
    expect(allText).toContain("shared prompt");
  });

  it("post-creation messages still apply addressedTo/audience filters even with inherit=true", () => {
    // The relaxation is for PRE-creation messages only. After the
    // persona joins, normal routing semantics apply — otherwise an
    // inherit persona would see every future @-target to anyone else
    // too, defeating the purpose of routing.
    const appi = persona({ id: "p_appi", createdAt: 0 });
    const kimi = persona({ id: "p_kimi", createdAt: 2, inherits: true });
    const messages = [
      // Pre-creation: kimi sees these.
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "pre-creation prompt",
        addressedTo: ["p_appi"],
        index: 0,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "pre-creation reply",
        provider: "claude",
        personaId: "p_appi",
        audience: ["p_appi"],
        index: 1,
      }),
      // Post-creation: kimi does NOT see this — it's routed to appi only.
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "post-creation private to appi",
        addressedTo: ["p_appi"],
        index: 2,
      }),
    ];
    const r = buildContext({
      conversation: CONV,
      target: targetFor(kimi),
      messages,
      personas: [appi, kimi],
    });
    const allText = r.messages.map((m) => m.content).join("\n");
    expect(allText).toContain("pre-creation prompt");
    expect(allText).toContain("pre-creation reply");
    expect(allText).not.toContain("post-creation private to appi");
  });
});
