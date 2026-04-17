// Tests for isExcludedByLimit visual-marker helper — issue #9.
import { describe, it, expect } from "vitest";
import { isExcludedByLimit } from "@/lib/context/excluded";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation } from "@/lib/types";

const baseConv: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
};

describe("isExcludedByLimit", () => {
  it("false when no limit is set", () => {
    const m = makeMessage({ conversationId: "c_1", role: "user", index: 0 });
    expect(isExcludedByLimit(m, baseConv)).toBe(false);
  });

  it("true for a non-pinned row before the mark", () => {
    const m = makeMessage({ conversationId: "c_1", role: "user", index: 0 });
    expect(isExcludedByLimit(m, { ...baseConv, limitMarkIndex: 2 })).toBe(true);
  });

  it("false for a row at the mark", () => {
    const m = makeMessage({ conversationId: "c_1", role: "user", index: 2 });
    expect(isExcludedByLimit(m, { ...baseConv, limitMarkIndex: 2 })).toBe(false);
  });

  it("false for a row after the mark", () => {
    const m = makeMessage({ conversationId: "c_1", role: "user", index: 3 });
    expect(isExcludedByLimit(m, { ...baseConv, limitMarkIndex: 2 })).toBe(false);
  });

  it("false for pinned rows even before the mark (they still survive)", () => {
    const m = makeMessage({ conversationId: "c_1", role: "user", index: 0, pinned: true });
    expect(isExcludedByLimit(m, { ...baseConv, limitMarkIndex: 2 })).toBe(false);
  });

  it("false for notice rows regardless of position", () => {
    const m = makeMessage({ conversationId: "c_1", role: "notice", content: "x", index: 0 });
    expect(isExcludedByLimit(m, { ...baseConv, limitMarkIndex: 5 })).toBe(false);
  });
});
