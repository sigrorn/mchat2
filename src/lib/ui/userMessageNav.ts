// ------------------------------------------------------------------
// Component: User-message navigation helper
// Responsibility: Pure mapping from current scroll position + a list
//                 of message offsets to the next up/down arrow targets
//                 and disabled-state used by the chat header (#137).
//                 Also picks which messages the arrows navigate based
//                 on whether a persona is selected for navigation.
// Collaborators: components/ChatView.tsx (header buttons + shortcuts),
//                components/PersonaPanel.tsx (nav-persona toggle).
// ------------------------------------------------------------------

import type { Message } from "@/lib/types";

export interface UserMsgPos {
  id: string;
  offsetTop: number;
}

export interface NavInputs {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  userMessages: readonly UserMsgPos[];
  // Distance between scrollTop and the visual top the user perceives
  // as the start of content (typically the container's padding-top).
  // The helper uses (scrollTop + viewportTopOffset) as the reference
  // for "above"/"below" so that, when we deliberately scroll to
  // (bubble.offsetTop - viewportTopOffset) to keep padding visible,
  // the bubble itself is not picked as the next target.
  viewportTopOffset?: number;
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
  const viewportTopOffset = inputs.viewportTopOffset ?? 0;
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
  const ref = scrollTop + viewportTopOffset;

  let prevId: string | null = null;
  for (const m of sorted) {
    if (m.offsetTop < ref - epsilon) prevId = m.id;
    else break;
  }

  let nextId: string | null = null;
  for (const m of sorted) {
    if (m.offsetTop > ref + epsilon) {
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

// #245: turn the virtualizer's measurements into the UserMsgPos[] shape
// `computeUserMsgNav` consumes. Sourcing positions from
// `virtualizer.measurementsCache` (where every item — mounted or not —
// has a `start` offset, measured or estimated) instead of from
// `el.querySelector("[data-message-id=...]")` is what lets the arrows
// step through user messages that are currently virtualized out.
//
// Pure: takes the navIds, the items index map, the cache, and the
// container's padding-top. Returns positions in the scroll container's
// coordinate space (paddingTop + measurement.start) so the same
// `viewportTopOffset = paddingTop` reference still applies in
// `computeUserMsgNav`.
export function userMsgPositionsFromMeasurements(
  navIds: readonly string[],
  itemIndexByMessageId: ReadonlyMap<string, number>,
  measurements: ReadonlyArray<{ start: number }>,
  paddingTop: number,
): UserMsgPos[] {
  const out: UserMsgPos[] = [];
  for (const id of navIds) {
    const idx = itemIndexByMessageId.get(id);
    if (idx === undefined) continue;
    const m = measurements[idx];
    if (!m) continue;
    out.push({ id, offsetTop: paddingTop + m.start });
  }
  return out;
}

// Pick the IDs the up/down arrows should navigate between. With no
// persona selected, that's every user message; with one selected, it's
// every assistant message authored by that persona. Notice rows are
// always excluded (they are UI-only and not navigable as commands).
export function selectNavMessageIds(
  messages: readonly Message[],
  navPersonaId: string | null,
): string[] {
  if (navPersonaId === null) {
    return messages.filter((m) => m.role === "user").map((m) => m.id);
  }
  return messages
    .filter((m) => m.role === "assistant" && m.personaId === navPersonaId)
    .map((m) => m.id);
}

// Tooltip text for the chat-header arrows. Reflects whether a persona
// is selected for navigation so the user understands what each press
// will scroll to.
export function navTooltipText(
  direction: "prev" | "next",
  personaName: string | null,
): string {
  const word = direction === "prev" ? "previous" : "next";
  const shortcut = direction === "prev" ? "Ctrl+Shift+Up" : "Ctrl+Shift+Down";
  const subject = personaName ? `message from ${personaName}` : `user command`;
  return `Scroll to ${word} ${subject} (${shortcut})`;
}
