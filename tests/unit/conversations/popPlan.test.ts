// //pop mutation planner — issue #48.
import { describe, it, expect } from "vitest";
import { planPop } from "@/lib/conversations/popPlan";
import { makeMessage } from "@/lib/persistence/messages";

describe("planPop", () => {
  it("identifies the last user message and every row after it", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "first", index: 0 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a1",
        provider: "mock",
        personaId: "p_a",
        index: 1,
      }),
      makeMessage({ conversationId: "c_1", role: "user", content: "second", index: 2 }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a2",
        provider: "mock",
        personaId: "p_a",
        index: 3,
      }),
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "a3",
        provider: "mock",
        personaId: "p_b",
        index: 4,
      }),
    ];
    const r = planPop(messages);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // restoredText is the popped user message's content
    expect(r.restoredText).toBe("second");
    // deleteIds covers the last user message + every following row
    expect(r.deleteIds).toHaveLength(3);
    expect(r.deleteIds).toContain(messages[2]!.id);
    expect(r.deleteIds).toContain(messages[3]!.id);
    expect(r.deleteIds).toContain(messages[4]!.id);
  });

  it("returns error when there are no user messages", () => {
    const messages = [
      makeMessage({
        conversationId: "c_1",
        role: "assistant",
        content: "hi",
        provider: "mock",
        personaId: "p_a",
        index: 0,
      }),
    ];
    const r = planPop(messages);
    expect(r.ok).toBe(false);
  });

  it("returns error when the conversation is empty", () => {
    expect(planPop([]).ok).toBe(false);
  });

  it("works when the last user message has no replies yet", () => {
    const messages = [
      makeMessage({ conversationId: "c_1", role: "user", content: "hi", index: 0 }),
    ];
    const r = planPop(messages);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.restoredText).toBe("hi");
    expect(r.deleteIds).toEqual([messages[0]!.id]);
  });
});
