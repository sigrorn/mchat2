// ------------------------------------------------------------------
// Component: Column-group helper
// Responsibility: Walk a message list once and split it into render
//                 items: 'row' for stacked rendering, 'columns' for
//                 contiguous assistant runs that share a non-empty
//                 audience (the parallel-send group).
// Collaborators: components/MessageList.tsx (cols mode).
// ------------------------------------------------------------------

import type { Message } from "../types";

export type RenderItem =
  | { kind: "row"; message: Message }
  | { kind: "columns"; audience: string[]; messages: Message[] };

export function groupIntoColumns(messages: readonly Message[]): RenderItem[] {
  const out: RenderItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (!m) {
      i++;
      continue;
    }
    if (m.role === "assistant" && m.audience.length > 0) {
      // Greedy: collect contiguous assistant rows with the same audience.
      const audience = m.audience;
      const run: Message[] = [m];
      let j = i + 1;
      while (j < messages.length) {
        const nxt = messages[j];
        if (!nxt || nxt.role !== "assistant" || !sameAudience(nxt.audience, audience)) {
          break;
        }
        run.push(nxt);
        j++;
      }
      // A 'columns' block needs at least 2 messages; a single-target
      // run reads more naturally as a stacked row.
      if (run.length >= 2) {
        out.push({ kind: "columns", audience: [...audience], messages: run });
      } else {
        out.push({ kind: "row", message: m });
      }
      i = j;
      continue;
    }
    out.push({ kind: "row", message: m });
    i++;
  }
  return out;
}

function sameAudience(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
