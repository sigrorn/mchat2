// Tail-follow pin detection — issue #6.
import { describe, it, expect } from "vitest";
import { isPinnedToBottom, shouldFollowTail } from "@/components/scrollPin";

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
    expect(isPinnedToBottom({ scrollTop: 850, clientHeight: 100, scrollHeight: 1000 }, 50)).toBe(
      true,
    );
    expect(isPinnedToBottom({ scrollTop: 840, clientHeight: 100, scrollHeight: 1000 }, 50)).toBe(
      false,
    );
  });

  it("treats non-overflow containers as pinned", () => {
    // If the content fits in the viewport, scrollHeight === clientHeight
    // and any scrollTop is 0; we are by definition 'at the bottom'.
    expect(isPinnedToBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toBe(true);
  });
});

describe("shouldFollowTail", () => {
  // Decides whether MessageList's layout effect should yank to bottom.
  // The intent is "follow newly-arrived content", not "stay glued
  // whenever pinned" — the latter fights with programmatic scrolls
  // that start near the bottom.

  it("follows when pinned and content grew", () => {
    expect(shouldFollowTail(1000, 1100, true)).toBe(true);
  });

  it("does not follow when pinned but content unchanged", () => {
    // Re-render unrelated to new content (e.g. metrics state update
    // during a programmatic scroll-up) must not yank to bottom.
    expect(shouldFollowTail(1000, 1000, true)).toBe(false);
  });

  it("does not follow when not pinned, even if content grew", () => {
    // User has scrolled up; new content arriving must not pull them
    // back to the tail.
    expect(shouldFollowTail(1000, 1100, false)).toBe(false);
  });

  it("does not follow when content shrank", () => {
    // E.g. /pop removed messages. Don't yank — the user's prior
    // scroll position relative to remaining content is more useful.
    expect(shouldFollowTail(1100, 1000, true)).toBe(false);
  });

  it("follows on initial render (prev = 0, current > 0, pinned)", () => {
    expect(shouldFollowTail(0, 800, true)).toBe(true);
  });
});
