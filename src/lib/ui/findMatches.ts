// ------------------------------------------------------------------
// Component: Find-in-chat match finder
// Responsibility: Pure plain-substring search across messages for the
//                 Ctrl+F find bar (#53). Returns match triples so the
//                 UI can highlight and scroll-into-view.
// Collaborators: components/FindBar (consumer), MessageList (highlight).
// ------------------------------------------------------------------

import type { Message } from "../types";

export interface FindMatch {
  messageId: string;
  start: number;
  end: number;
}

export function findMatches(
  messages: readonly Message[],
  query: string,
  caseSensitive: boolean,
): FindMatch[] {
  if (query === "") return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: FindMatch[] = [];
  for (const m of messages) {
    if (!m.content) continue;
    const haystack = caseSensitive ? m.content : m.content.toLowerCase();
    let i = 0;
    while (i < haystack.length) {
      const idx = haystack.indexOf(needle, i);
      if (idx === -1) break;
      out.push({ messageId: m.id, start: idx, end: idx + needle.length });
      i = idx + Math.max(1, needle.length);
    }
  }
  return out;
}
