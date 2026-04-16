// ------------------------------------------------------------------
// Component: Tail-group failure finder
// Responsibility: Helper for //retry (#49). Scan backward from the
//                 end of the conversation to the nearest user row
//                 and return every assistant row after it that has
//                 errorMessage set.
// Collaborators: components/Composer (runCommand retry branch),
//                hooks/useSend.retry.
// ------------------------------------------------------------------

import type { Message } from "../types";

export function findFailedRowsInLastGroup(messages: readonly Message[]): Message[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return [];
  const out: Message[] = [];
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === "assistant" && m.errorMessage !== null) {
      out.push(m);
    }
  }
  return out;
}
