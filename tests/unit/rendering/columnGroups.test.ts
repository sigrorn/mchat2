// Column-group helper for cols-mode rendering — issue #16.
import { describe, it, expect } from "vitest";
import { groupIntoColumns } from "@/lib/rendering/columnGroups";
import { makeMessage } from "@/lib/persistence/messages";

describe("groupIntoColumns", () => {
  it("empty input → empty output", () => {
    expect(groupIntoColumns([])).toEqual([]);
  });

  it("single user row stays as a row item", () => {
    const m = makeMessage({ conversationId: "c_1", role: "user", index: 0, content: "hi" });
    expect(groupIntoColumns([m])).toEqual([{ kind: "row", message: m }]);
  });

  it("contiguous assistant rows with same audience → one columns block", () => {
    const a = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_a",
      index: 0,
      audience: ["p_a", "p_b"],
    });
    const b = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_b",
      index: 1,
      audience: ["p_a", "p_b"],
    });
    const out = groupIntoColumns([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("columns");
    if (out[0]?.kind === "columns") {
      expect(out[0].audience).toEqual(["p_a", "p_b"]);
      expect(out[0].messages).toEqual([a, b]);
    }
  });

  it("assistant rows with different audiences stay as separate rows", () => {
    const a = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_a",
      index: 0,
      audience: ["p_a"],
    });
    const b = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_b",
      index: 1,
      audience: ["p_b"],
    });
    const out = groupIntoColumns([a, b]);
    expect(out.map((x) => x.kind)).toEqual(["row", "row"]);
  });

  it("assistant with empty audience falls through as a row (legacy)", () => {
    const a = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_a",
      index: 0,
      audience: [],
    });
    const out = groupIntoColumns([a]);
    expect(out[0]?.kind).toBe("row");
  });

  it("user row breaks the column run", () => {
    const a = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_a",
      index: 0,
      audience: ["p_a", "p_b"],
    });
    const u = makeMessage({ conversationId: "c_1", role: "user", index: 1 });
    const b = makeMessage({
      conversationId: "c_1",
      role: "assistant",
      provider: "mock",
      personaId: "p_b",
      index: 2,
      audience: ["p_a", "p_b"],
    });
    const out = groupIntoColumns([a, u, b]);
    // Single-message column-eligible runs collapse to a row item too.
    expect(out.map((x) => x.kind)).toEqual(["row", "row", "row"]);
  });
});
