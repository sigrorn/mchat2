// User-message-number helpers — issue #8.
import { describe, it, expect } from "vitest";
import { userNumberByIndex, indexByUserNumber } from "@/lib/conversations/userMessageNumber";
import { makeMessage } from "@/lib/persistence/messages";
import type { Message } from "@/lib/types";

function history(): Message[] {
  return [
    makeMessage({ conversationId: "c_1", role: "user", content: "u1", index: 0 }),
    makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "a1",
      provider: "mock",
      index: 1,
    }),
    makeMessage({ conversationId: "c_1", role: "user", content: "u2", index: 2 }),
    makeMessage({
      conversationId: "c_1",
      role: "assistant",
      content: "a2",
      provider: "mock",
      index: 3,
    }),
    makeMessage({ conversationId: "c_1", role: "user", content: "u3", index: 4 }),
  ];
}

describe("userNumberByIndex", () => {
  it("maps each message's index to 1-based user number, null for non-user rows", () => {
    const map = userNumberByIndex(history());
    expect(map.get(0)).toBe(1);
    expect(map.get(1)).toBeUndefined();
    expect(map.get(2)).toBe(2);
    expect(map.get(3)).toBeUndefined();
    expect(map.get(4)).toBe(3);
  });
});

describe("indexByUserNumber", () => {
  it("returns the message.index of the Nth user row", () => {
    const h = history();
    expect(indexByUserNumber(h, 1)).toBe(0);
    expect(indexByUserNumber(h, 2)).toBe(2);
    expect(indexByUserNumber(h, 3)).toBe(4);
  });

  it("returns null when N is out of range", () => {
    const h = history();
    expect(indexByUserNumber(h, 0)).toBeNull();
    expect(indexByUserNumber(h, 4)).toBeNull();
    expect(indexByUserNumber(h, -1)).toBeNull();
  });
});
