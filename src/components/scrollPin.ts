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
