// ------------------------------------------------------------------
// Component: User-message navigation helper
// Responsibility: Pure mapping from current scroll position + user
//                 message offsets to the next up/down arrow targets
//                 and disabled-state used by the chat header (#137).
// Collaborators: components/ChatView.tsx (header buttons + shortcuts).
// ------------------------------------------------------------------

export interface UserMsgPos {
  id: string;
  offsetTop: number;
}

export interface NavInputs {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  userMessages: readonly UserMsgPos[];
}

export interface NavState {
  prevId: string | null;
  nextId: string | null;
  nextIsBottom: boolean;
  upDisabled: boolean;
  downDisabled: boolean;
}

export function computeUserMsgNav(inputs: NavInputs, epsilon = 1): NavState {
  const { scrollTop, scrollHeight, clientHeight, userMessages } = inputs;
  if (userMessages.length === 0) {
    return {
      prevId: null,
      nextId: null,
      nextIsBottom: false,
      upDisabled: true,
      downDisabled: true,
    };
  }
  const sorted = [...userMessages].sort((a, b) => a.offsetTop - b.offsetTop);
  const atBottom = scrollHeight - (scrollTop + clientHeight) <= epsilon;

  let prevId: string | null = null;
  for (const m of sorted) {
    if (m.offsetTop < scrollTop - epsilon) prevId = m.id;
    else break;
  }

  let nextId: string | null = null;
  for (const m of sorted) {
    if (m.offsetTop > scrollTop + epsilon) {
      nextId = m.id;
      break;
    }
  }

  // At-or-past the last user message but not yet at the bottom of the
  // chat: a single "down" press should land on the very bottom so the
  // user can reach the latest assistant output without further scrolling.
  const nextIsBottom = nextId === null && !atBottom;

  return {
    prevId,
    nextId,
    nextIsBottom,
    upDisabled: prevId === null,
    downDisabled: nextId === null && !nextIsBottom,
  };
}

// Translate a target bubble's offsetTop into a scrollTop that keeps the
// container's natural top padding visible above the bubble — otherwise
// the bubble's header line ends up flush with the chat header and looks
// truncated.
export function computeScrollTarget(targetOffsetTop: number, paddingTop: number): number {
  return Math.max(0, targetOffsetTop - paddingTop);
}
