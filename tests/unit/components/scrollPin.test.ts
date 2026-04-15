// Tail-follow pin detection — issue #6.
import { describe, it, expect } from "vitest";
import { isPinnedToBottom } from "@/components/scrollPin";

describe("isPinnedToBottom", () => {
  it("true when exactly at the bottom", () => {
    expect(isPinnedToBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it("true within the default 8px threshold", () => {
    expect(isPinnedToBottom({ scrollTop: 895, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it("false once scrolled more than threshold away", () => {
    expect(isPinnedToBottom({ scrollTop: 800, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });

  it("honors an explicit threshold", () => {
    expect(
      isPinnedToBottom({ scrollTop: 850, clientHeight: 100, scrollHeight: 1000 }, 50),
    ).toBe(true);
    expect(
      isPinnedToBottom({ scrollTop: 840, clientHeight: 100, scrollHeight: 1000 }, 50),
    ).toBe(false);
  });

  it("treats non-overflow containers as pinned", () => {
    // If the content fits in the viewport, scrollHeight === clientHeight
    // and any scrollTop is 0; we are by definition 'at the bottom'.
    expect(isPinnedToBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toBe(true);
  });
});
