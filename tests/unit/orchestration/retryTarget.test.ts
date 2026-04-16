// Reconstructing the PersonaTarget for a manual retry — issue #43.
import { describe, it, expect } from "vitest";
import { buildRetryTarget } from "@/lib/orchestration/retryTarget";
import { makeMessage } from "@/lib/persistence/messages";
import type { Persona } from "@/lib/types";

function persona(over: Partial<Persona> & { id: string; name: string }): Persona {
  return {
    conversationId: "c_1",
    provider: "claude",
    nameSlug: over.name.toLowerCase(),
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

describe("buildRetryTarget", () => {
  it("reconstructs a persona target from a failed assistant message", () => {
    const personas = [persona({ id: "p_alice", name: "Alice", provider: "claude" })];
    const failed = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "claude",
      personaId: "p_alice",
      content: "",
      errorMessage: "HTTP 503: high demand",
    });
    const t = buildRetryTarget(failed, personas);
    expect(t).toEqual({
      provider: "claude",
      personaId: "p_alice",
      key: "p_alice",
      displayName: "Alice",
    });
  });

  it("falls back to a bare-provider target when the persona is gone", () => {
    const failed = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "openai",
      personaId: "p_ghost",
      content: "",
      errorMessage: "boom",
    });
    const t = buildRetryTarget(failed, []);
    expect(t?.provider).toBe("openai");
    expect(t?.personaId).toBeNull();
    expect(t?.key).toBe("openai");
  });

  it("returns a bare target when the message has no personaId at all", () => {
    const failed = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mistral",
      personaId: null,
      content: "",
      errorMessage: "x",
    });
    const t = buildRetryTarget(failed, []);
    expect(t?.provider).toBe("mistral");
    expect(t?.personaId).toBeNull();
  });

  it("returns null when the message has no provider (can't retry)", () => {
    const orphan = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: null,
      personaId: null,
      content: "",
      errorMessage: "x",
    });
    expect(buildRetryTarget(orphan, [])).toBeNull();
  });

  it("returns null for non-assistant rows (retry is only for assistant failures)", () => {
    const userMsg = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "hi",
    });
    expect(buildRetryTarget(userMsg, [])).toBeNull();
  });
});
