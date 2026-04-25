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
