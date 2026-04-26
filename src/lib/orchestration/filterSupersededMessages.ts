// ------------------------------------------------------------------
// Component: filterSupersededMessages
// Responsibility: Default-hide assistant rows whose Attempt has been
//                 superseded by a later one (#174 → #180). Today this
//                 is mostly a no-op because retry/replay still delete
//                 the old rows; the predicate is in place so a future
//                 issue can stop deleting and rely on this filter to
//                 keep the UI tidy.
// Collaborators: callers compute the superseded id set upstream
//                (e.g. from listAttempts) and pass it in. Rendering
//                code stays sync.
// ------------------------------------------------------------------

import type { Message } from "../types";

export function filterSupersededMessages(
  messages: readonly Message[],
  supersededIds: ReadonlySet<string>,
): Message[] {
  if (supersededIds.size === 0) return [...messages];
  return messages.filter((m) => m.role !== "assistant" || !supersededIds.has(m.id));
}
