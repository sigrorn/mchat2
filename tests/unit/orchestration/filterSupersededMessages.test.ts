// filterSupersededMessages — UI filter that hides assistant rows
// whose Attempt has been superseded (#174 → #180). Pure function so
// the rendering path doesn't need to async-fetch attempt state per
// render: the caller computes a Set<string> of superseded message
// ids upstream and threads it through.
import { describe, it, expect } from "vitest";
import type { Message } from "@/lib/types";
import { filterSupersededMessages } from "@/lib/orchestration/filterSupersededMessages";

function msg(id: string, role: "user" | "assistant", index: number): Message {
  return {
    id,
    conversationId: "c_1",
    role,
    content: "x",
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: 0,
    index,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
    ttftMs: null,
    streamMs: null,
  };
}

describe("filterSupersededMessages", () => {
  it("returns input unchanged when no ids are superseded (the common case today)", () => {
    const messages = [msg("u1", "user", 0), msg("a1", "assistant", 1)];
    const result = filterSupersededMessages(messages, new Set());
    expect(result).toEqual(messages);
  });

  it("removes assistant rows whose ids appear in the superseded set", () => {
    const messages = [
      msg("u1", "user", 0),
      msg("a_old", "assistant", 1),
      msg("a_new", "assistant", 2),
    ];
    const result = filterSupersededMessages(messages, new Set(["a_old"]));
    expect(result.map((m) => m.id)).toEqual(["u1", "a_new"]);
  });

  it("never filters user rows (only assistants carry attempts)", () => {
    const messages = [msg("u1", "user", 0), msg("a1", "assistant", 1)];
    // Even if a user id ends up in the set by mistake, leave it alone.
    const result = filterSupersededMessages(messages, new Set(["u1"]));
    expect(result).toEqual(messages);
  });
});
