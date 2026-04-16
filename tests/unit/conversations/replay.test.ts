// Edit / replay plan helper — issue #44.
import { describe, it, expect } from "vitest";
import { planReplay } from "@/lib/conversations/replay";
import { makeMessage } from "@/lib/persistence/messages";

describe("planReplay", () => {
  it("returns update + delete set for the edit", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "hello",
        provider: "mock",
        personaId: "p_a",
        index: 1,
      }),
      makeMessage({ conversationId: "c_1", role: "user", content: "more?", index: 2 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "yes",
        provider: "mock",
        personaId: "p_a",
        index: 3,
      }),
    ];
    const editTarget = messages[2]!; // 'more?'
    const plan = planReplay(messages, editTarget.id, "different prompt", []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.update.id).toBe(editTarget.id);
    expect(plan.update.content).toBe("different prompt");
    // Must delete the assistant row *after* the edited user msg.
    expect(plan.deleteIds).toEqual([messages[3]!.id]);
  });

  it("rejects editing a non-user row", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "hi",
        index: 0,
        provider: "mock",
        personaId: "p_a",
      }),
    ];
    const plan = planReplay(messages, messages[0]!.id, "x", []);
    expect(plan.ok).toBe(false);
  });

  it("rejects editing a non-existent message", () => {
    const plan = planReplay([], "missing", "x", []);
    expect(plan.ok).toBe(false);
  });

  it("updates the message's addressedTo from the resolver result", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "old", index: 0 }),
    ];
    const plan = planReplay(messages, messages[0]!.id, "new", ["p_bob"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.update.addressedTo).toEqual(["p_bob"]);
  });

  it("preserves pinned flag (user may edit pinned prompts)", () => {
    const pinned = makeMessage({
      conversationId: "c_1",
      role: "user",
      content: "be brief",
      index: 0,
      pinned: true,
    });
    const plan = planReplay([pinned], pinned.id, "always concise", []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // We only update content + addressedTo; pinned stays whatever it was.
    expect(plan.update.id).toBe(pinned.id);
    expect(plan.update.content).toBe("always concise");
  });

  it("delete set is empty when editing the last user message with no follow-ups", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
    ];
    const plan = planReplay(messages, messages[0]!.id, "hello there", []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.deleteIds).toEqual([]);
  });
});
