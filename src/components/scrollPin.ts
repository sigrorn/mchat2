// ------------------------------------------------------------------
// Component: Scroll-pin helper
// Responsibility: Pure check for 'is the scroll container effectively
//                 at the bottom?' — used by MessageList to decide
//                 whether to follow incoming content tail-style.
// Collaborators: components/MessageList.tsx.
// ------------------------------------------------------------------

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

// Threshold accounts for fractional pixels and slow streaming: a user
// who is 2-3px from the bottom is intending to follow, not to read.
export function isPinnedToBottom(m: ScrollMetrics, threshold = 8): boolean {
  const distanceFromBottom = m.scrollHeight - (m.scrollTop + m.clientHeight);
  return distanceFromBottom <= threshold;
}

// Should the tail-follow layout effect yank scrollTop to the bottom?
// The original "always when pinned" rule fights any programmatic scroll
// that starts near the bottom: onScroll re-asserts pinnedRef during the
// first frames within the 8px threshold, and the yank cancels the
// scroll. The corrected rule fires only when scrollHeight actually
// grew — that's the case the tail-follow was designed for (streaming
// new tokens, new message rows). Re-renders triggered by metrics or
// other state updates leave the scroll position alone.
export function shouldFollowTail(
  prevScrollHeight: number,
  currentScrollHeight: number,
  isPinned: boolean,
): boolean {
  return isPinned && currentScrollHeight > prevScrollHeight;
}

// #246: layout-effect-friendly version of `shouldFollowTail` that
// derives "was the user pinned?" from live scroll metrics instead of
// a mutable ref. The previous implementation read `pinnedRef.current`,
// which is updated by an asynchronous browser scroll event — so a
// streaming token re-render that fired before the user's scroll event
// had been dispatched would see stale-true and yank back to the
// bottom mid-read.
//
// Anchor on the *previous* scrollHeight: the question is "where was
// the user when the new content arrived?" `el.scrollTop` reflects a
// wheel-scroll synchronously, so reading it lets the layout effect
// catch the wheel-scroll on the very next render even when the
// scroll event is still queued.
//
// Initial render (prev=0) naturally yanks when content is present:
// `prevScrollHeight - (scrollTop + clientHeight)` is negative, which
// is ≤ threshold, so wasPinned is true.
export function decideTailFollow(
  prevScrollHeight: number,
  currentScrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 8,
): boolean {
  if (currentScrollHeight <= prevScrollHeight) return false;
  return isPinnedToBottom(
    { scrollTop, clientHeight, scrollHeight: prevScrollHeight },
    threshold,
  );
}
