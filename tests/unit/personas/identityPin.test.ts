// Tests for the auto-inserted identity pin — issue #3.
import { describe, it, expect } from "vitest";
import { buildIdentityPinContent, ensureIdentityPin } from "@/lib/personas/identityPin";
import { makeMessage } from "@/lib/persistence/messages";
import type { Message, Persona } from "@/lib/types";

function persona(over: Partial<Persona> = {}): Persona {
  return {
    id: "p_alice",
    conversationId: "c_1",
    provider: "claude",
    name: "Alice",
    nameSlug: "alice",
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    runsAfter: null,
    deletedAt: null,
    ...over,
  };
}

describe("buildIdentityPinContent", () => {
  it("matches the exact wording from mchat", () => {
    expect(buildIdentityPinContent("Alice")).toBe(
      "Unless I say otherwise, for the scope of our chat, if my inputs refer to your name, use Alice as your name. I might refer to it in order to use it as a placeholder, and I want you to refer to yourself as Alice.",
    );
  });
});

describe("ensureIdentityPin", () => {
  it("inserts a new pinned user message when no identity pin exists yet", async () => {
    const appended: Message[] = [];
    const updated: { id: string; content: string }[] = [];
    const repo = {
      appendMessage: async (m: Parameters<typeof makeMessage>[0]): Promise<Message> => {
        const full = makeMessage({ ...m, id: "m_new", index: 99 });
        appended.push(full);
        return full;
      },
      updateMessageContent: async (id: string, content: string) => {
        updated.push({ id, content });
      },
    };
    await ensureIdentityPin("c_1", persona(), [], repo);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.pinned).toBe(true);
    expect(appended[0]?.pinTarget).toBe("p_alice");
    expect(appended[0]?.role).toBe("user");
    expect(appended[0]?.content).toContain("Alice");
    expect(updated).toHaveLength(0);
  });

  it("is a no-op when the pin already exists with current text", async () => {
    const existing = makeMessage({
      conversationId: "c_1",
      id: "m_existing",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentityPinContent("Alice"),
    });
    const appended: Message[] = [];
    const updated: { id: string; content: string }[] = [];
    const repo = {
      appendMessage: async (): Promise<Message> => {
        throw new Error("should not append");
      },
      updateMessageContent: async (id: string, content: string) => {
        updated.push({ id, content });
      },
    };
    await ensureIdentityPin("c_1", persona(), [existing], repo);
    expect(appended).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it("updates the existing pin in place on rename — no duplicate row", async () => {
    const existing = makeMessage({
      conversationId: "c_1",
      id: "m_existing",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentityPinContent("OldName"),
    });
    const appended: Message[] = [];
    const updated: { id: string; content: string }[] = [];
    const repo = {
      appendMessage: async (): Promise<Message> => {
        throw new Error("should not append");
      },
      updateMessageContent: async (id: string, content: string) => {
        updated.push({ id, content });
      },
    };
    await ensureIdentityPin("c_1", persona({ name: "NewName" }), [existing], repo);
    expect(appended).toHaveLength(0);
    expect(updated).toEqual([
      { id: "m_existing", content: buildIdentityPinContent("NewName") },
    ]);
  });
});
