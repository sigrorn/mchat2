// Tests for the auto-inserted identity pin — issue #3.
import { describe, it, expect } from "vitest";
import {
  buildIdentityPinContent,
  buildIdentitySetupNote,
  ensureIdentityPin,
} from "@/lib/personas/identityPin";
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
    runsAfter: [],
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null,
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

describe("buildIdentitySetupNote (#38)", () => {
  it("matches old mchat's setup-note phrasing", () => {
    // Imported via re-export from identityPin module; keeps the magic
    // string in one place.
    expect(buildIdentitySetupNote("Alice", "claude", "inherit")).toBe(
      'Added persona "Alice" (claude, inherit)',
    );
  });
});

describe("ensureIdentityPin", () => {
  it("inserts identity pin + setup notice (#38, #88)", async () => {
    const appended: Message[] = [];
    const updated: { id: string; content: string }[] = [];
    let nextIdx = 99;
    const repo = {
      appendMessage: async (m: Parameters<typeof makeMessage>[0]): Promise<Message> => {
        const full = makeMessage({ ...m, id: `m_${nextIdx}`, index: nextIdx++ });
        appended.push(full);
        return full;
      },
      updateMessageContent: async (id: string, content: string) => {
        updated.push({ id, content });
      },
    };
    await ensureIdentityPin("c_1", persona(), [], repo);
    expect(appended).toHaveLength(2);
    // First: pinned identity instruction for the LLM
    expect(appended[0]?.pinned).toBe(true);
    expect(appended[0]?.pinTarget).toBe("p_alice");
    expect(appended[0]?.role).toBe("user");
    expect(appended[0]?.content).toContain("use Alice as your name");
    // Second: notice for the user (not sent to LLMs)
    expect(appended[1]?.role).toBe("notice");
    expect(appended[1]?.pinned).toBe(false);
    expect(appended[1]?.content).toBe('Added persona "Alice" (claude, inherit)');
    expect(updated).toHaveLength(0);
  });

  it("is a no-op when both pins already exist with current text", async () => {
    const existing1 = makeMessage({
      conversationId: "c_1",
      id: "m_existing_1",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentityPinContent("Alice"),
    });
    const existing2 = makeMessage({
      conversationId: "c_1",
      id: "m_existing_2",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentitySetupNote("Alice", "claude", "inherit"),
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
    await ensureIdentityPin("c_1", persona(), [existing1, existing2], repo);
    expect(appended).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it("updates identity pin on rename; legacy setup pin blocks new notice (#38, #88)", async () => {
    const existing1 = makeMessage({
      conversationId: "c_1",
      id: "m_existing_1",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentityPinContent("OldName"),
    });
    const existing2 = makeMessage({
      conversationId: "c_1",
      id: "m_existing_2",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentitySetupNote("OldName", "claude", "inherit"),
    });
    const appended: Message[] = [];
    const updated: { id: string; content: string }[] = [];
    let nextIdx = 200;
    const repo = {
      appendMessage: async (m: Parameters<typeof makeMessage>[0]): Promise<Message> => {
        const full = makeMessage({ ...m, id: `m_${nextIdx}`, index: nextIdx++ });
        appended.push(full);
        return full;
      },
      updateMessageContent: async (id: string, content: string) => {
        updated.push({ id, content });
      },
    };
    await ensureIdentityPin("c_1", persona({ name: "NewName" }), [existing1, existing2], repo);
    // Identity pin updated in place
    expect(updated).toContainEqual({
      id: "m_existing_1",
      content: buildIdentityPinContent("NewName"),
    });
    // Legacy setup pin exists → no new notice appended
    expect(appended).toHaveLength(0);
  });

  it("backfills the setup-note when only the legacy identity pin exists (#38)", async () => {
    const legacy = makeMessage({
      conversationId: "c_1",
      id: "m_legacy",
      role: "user",
      pinned: true,
      pinTarget: "p_alice",
      content: buildIdentityPinContent("Alice"),
    });
    const appended: Message[] = [];
    const updated: { id: string; content: string }[] = [];
    const repo = {
      appendMessage: async (m: Parameters<typeof makeMessage>[0]): Promise<Message> => {
        const full = makeMessage({ ...m, id: "m_added", index: 100 });
        appended.push(full);
        return full;
      },
      updateMessageContent: async (id: string, content: string) => {
        updated.push({ id, content });
      },
    };
    await ensureIdentityPin("c_1", persona(), [legacy], repo);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.content).toBe(buildIdentitySetupNote("Alice", "claude", "inherit"));
    expect(updated).toHaveLength(0);
  });
});
