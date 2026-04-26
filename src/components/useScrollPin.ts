// ------------------------------------------------------------------
// Component: useScrollPin
// Responsibility: Hook that wires up tail-follow / scroll-pin behavior
//                 for a scrollable container (#137). Exposes:
//                   - pinnedRef: mutable flag, true while the user is
//                     near the bottom; flipped on every onScroll.
//                   - onScroll: handler the container must register.
//                 The internal layout effect yanks scrollTop to the
//                 bottom only when scrollHeight grew (new content
//                 appended). Other re-renders — metrics state during
//                 a programmatic scroll, font-zoom changes, etc. —
//                 leave the scroll position alone, otherwise the pin's
//                 8px threshold traps any scroll initiated near the
//                 bottom (#137 follow-up).
//                 Extracted from MessageList.tsx in #167.
// Collaborators: MessageList, ChatView (forwards refs for header
//                arrows), scrollPin (predicates).
// ------------------------------------------------------------------

import { useLayoutEffect, useRef, type RefObject } from "react";
import { isPinnedToBottom, shouldFollowTail } from "./scrollPin";

export interface UseScrollPinResult {
  pinnedRef: React.MutableRefObject<boolean>;
  onScroll: () => void;
}

export function useScrollPin(
  containerRef: RefObject<HTMLElement | null>,
  externalPinnedRef?: React.MutableRefObject<boolean>,
  onScrollCallback?: () => void,
): UseScrollPinResult {
  const internalPinnedRef = useRef(true);
  const pinnedRef = externalPinnedRef ?? internalPinnedRef;

  const onScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = isPinnedToBottom({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    });
    onScrollCallback?.();
  };

  // Layout effect runs synchronously after DOM mutation, before paint,
  // so the user never sees an intermediate frame where new content is
  // below the fold.
  const prevScrollHeightRef = useRef(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (shouldFollowTail(prevScrollHeightRef.current, el.scrollHeight, pinnedRef.current)) {
      el.scrollTop = el.scrollHeight;
    }
    prevScrollHeightRef.current = el.scrollHeight;
  });

  return { pinnedRef, onScroll };
}
