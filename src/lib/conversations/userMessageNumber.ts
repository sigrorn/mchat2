// ------------------------------------------------------------------
// Component: User-message numbering
// Responsibility: Bidirectional map between the 1-based display
//                 number of a user message (used in [N] prefixes and
//                 //limit arguments) and its internal Message.index.
// Collaborators: components/MessageList.tsx (prefix rendering),
//                components/Composer.tsx (//limit handling).
// ------------------------------------------------------------------

import type { Message } from "../types";

// Map from message.index → user-number (1-based) for every user row.
// Non-user rows are absent from the returned map so callers can
// distinguish 'not a user row' (undefined) from 'first user row' (1).
export function userNumberByIndex(messages: readonly Message[]): Map<number, number> {
  const m = new Map<number, number>();
  let n = 0;
  for (const msg of messages) {
    if (msg.role === "user") {
      n += 1;
      m.set(msg.index, n);
    }
  }
  return m;
}

// Return the internal Message.index of the Nth user row, or null if
// N is out of range (≤ 0 or greater than the count of user rows).
export function indexByUserNumber(messages: readonly Message[], userNumber: number): number | null {
  if (userNumber < 1) return null;
  let n = 0;
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    n += 1;
    if (n === userNumber) return msg.index;
  }
  return null;
}

export function userMessageCount(messages: readonly Message[]): number {
  let n = 0;
  for (const m of messages) if (m.role === "user") n += 1;
  return n;
}
