// Tail-follow pin detection — issue #6.
import { describe, it, expect } from "vitest";
import { decideTailFollow, isPinnedToBottom, shouldFollowTail } from "@/components/scrollPin";

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

// #246: the layout effect previously decided tail-follow off
// `pinnedRef.current`, which is only updated when the container's
// `onScroll` event fires. Browser scroll events are dispatched
// asynchronously (throttled to once per frame), so a streaming token
// that mutates state and forces a synchronous re-render can run the
// layout effect *before* the pending scroll event has fired. With
// `pinnedRef` still reading "at the bottom" from a moment earlier,
// the effect saw scrollHeight grow and yanked the user back, undoing
// their wheel-scroll. `decideTailFollow` reads `el.scrollTop` against
// `prevScrollHeight` instead, so wheel-scroll changes (which are
// already reflected in scrollTop synchronously) take effect on the
// very next render.
describe("decideTailFollow (#246)", () => {
  it("does not yank when scrollHeight didn't grow", () => {
    // Re-renders unrelated to new content (metrics state, find state)
    // never tail-follow, even if the user happens to be at the bottom.
    expect(decideTailFollow(1000, 1000, 500, 500)).toBe(false);
  });

  it("does not yank when scrollHeight shrank (e.g. /pop)", () => {
    expect(decideTailFollow(1100, 1000, 500, 500)).toBe(false);
  });

  it("yanks when content grew and the user was at the previous bottom", () => {
    // scrollTop=500, clientHeight=500 ⇒ user's view ended at 1000,
    // exactly the previous bottom. Token grew content to 1100 → follow.
    expect(decideTailFollow(1000, 1100, 500, 500)).toBe(true);
  });

  it("yanks when content grew and the user was within the 8px threshold", () => {
    expect(decideTailFollow(1000, 1100, 494, 500)).toBe(true);
  });

  it("does NOT yank when content grew but the user wheel-scrolled away (#246)", () => {
    // The regression. Pre-fix: pinnedRef was stale-true between the
    // wheel-scroll and the (async) scroll event, so the effect saw
    // `pinned && grew` and yanked back. Post-fix: live el.scrollTop
    // against prev scrollHeight reflects the wheel-scroll immediately —
    // distance from prev bottom = 1000 - (200+500) = 300 > 8 → no yank.
    expect(decideTailFollow(1000, 1100, 200, 500)).toBe(false);
  });

  it("yanks on initial render (prev=0, content present)", () => {
    // First paint: prevScrollHeight=0, content rendered. distance from
    // "previous bottom" = 0 - (0+500) = -500, well within threshold,
    // so wasPinned=true and the user lands at the tail.
    expect(decideTailFollow(0, 800, 0, 500)).toBe(true);
  });

  it("honors a custom threshold", () => {
    // 50px gap from previous bottom — outside default 8px, inside 60.
    expect(decideTailFollow(1000, 1100, 450, 500)).toBe(false);
    expect(decideTailFollow(1000, 1100, 450, 500, 60)).toBe(true);
  });
});
