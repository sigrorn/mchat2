// Resolving //edit's userNumber to a concrete message id — issue #47.
import { describe, it, expect } from "vitest";
import { resolveEditTarget } from "@/lib/conversations/resolveEditTarget";
import { makeMessage } from "@/lib/persistence/messages";

function u(id: string, index: number) {
  return makeMessage({ conversationId: "c_1", id, role: "user", content: id, index });
}
function a(id: string, index: number) {
  return makeMessage({
    conversationId: "c_1",
    id,
    role: "assistant",
    content: id,
    index,
    provider: "mock",
    personaId: "p_a",
  });
}

const HISTORY = [u("u1", 0), a("a1", 1), u("u2", 2), a("a2", 3), u("u3", 4)];

describe("resolveEditTarget", () => {
  it("null targets the last user message", () => {
    expect(resolveEditTarget(HISTORY, null)?.id).toBe("u3");
  });

  it("positive N targets the Nth user message (1-indexed)", () => {
    expect(resolveEditTarget(HISTORY, 1)?.id).toBe("u1");
    expect(resolveEditTarget(HISTORY, 2)?.id).toBe("u2");
    expect(resolveEditTarget(HISTORY, 3)?.id).toBe("u3");
  });

  it("-1 targets the last, -2 targets the second-to-last, etc.", () => {
    expect(resolveEditTarget(HISTORY, -1)?.id).toBe("u3");
    expect(resolveEditTarget(HISTORY, -2)?.id).toBe("u2");
    expect(resolveEditTarget(HISTORY, -3)?.id).toBe("u1");
  });

  it("returns null when positive N is out of range", () => {
    expect(resolveEditTarget(HISTORY, 4)).toBeNull();
  });

  it("returns null when negative N is out of range", () => {
    expect(resolveEditTarget(HISTORY, -4)).toBeNull();
  });

  it("returns null when the conversation has no user messages", () => {
    expect(resolveEditTarget([], null)).toBeNull();
    expect(resolveEditTarget([a("a0", 0)], null)).toBeNull();
  });

  it("skips non-user rows when counting", () => {
    // Identity pins are user-role rows too, so they DO count.
    // Notices / assistants / pins-as-user don't affect the absolute
    // index: resolveEditTarget counts every user row in order.
    const pin = makeMessage({
      conversationId: "c_1",
      id: "pin",
      role: "user",
      pinned: true,
      pinTarget: "p_a",
      content: "use alice as your name",
      index: 0,
    });
    const hist = [pin, u("u1", 1), a("a1", 2), u("u2", 3)];
    // resolveEditTarget returns the 2nd user message = u1 (pins count).
    expect(resolveEditTarget(hist, 2)?.id).toBe("u1");
  });
});
