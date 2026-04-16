// Tail-group failed-row finder for //retry — issue #49.
import { describe, it, expect } from "vitest";
import { findFailedRowsInLastGroup } from "@/lib/orchestration/findFailedRowsInLastGroup";
import { makeMessage } from "@/lib/persistence/messages";

function u(id: string, index: number) {
  return makeMessage({ conversationId: "c_1", id, role: "user", content: id, index });
}
function a(id: string, index: number, error?: string) {
  return makeMessage({
    conversationId: "c_1",
    id,
    role: "assistant",
    content: error ? "" : id,
    provider: "mock",
    personaId: "p_a",
    index,
    ...(error ? { errorMessage: error } : {}),
  });
}

describe("findFailedRowsInLastGroup", () => {
  it("returns every failed assistant after the last user message", () => {
    const messages = [
      u("u1", 0),
      a("a1", 1, "boom"),
      a("a2", 2, "kaboom"),
    ];
    const rows = findFailedRowsInLastGroup(messages);
    expect(rows.map((m) => m.id)).toEqual(["a1", "a2"]);
  });

  it("does not look before the last user message", () => {
    const messages = [
      u("u1", 0),
      a("a1", 1, "old failure, already retried"),
      u("u2", 2),
      a("a2", 3, "new failure"),
    ];
    const rows = findFailedRowsInLastGroup(messages);
    expect(rows.map((m) => m.id)).toEqual(["a2"]);
  });

  it("returns empty when the tail group has no failures", () => {
    const messages = [u("u1", 0), a("a1", 1)];
    expect(findFailedRowsInLastGroup(messages)).toEqual([]);
  });

  it("returns empty when there are no user messages at all", () => {
    expect(findFailedRowsInLastGroup([a("a1", 0, "x")])).toEqual([]);
  });

  it("returns empty for empty history", () => {
    expect(findFailedRowsInLastGroup([])).toEqual([]);
  });
});
