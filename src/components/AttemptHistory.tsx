// ------------------------------------------------------------------
// Component: AttemptHistory
// Responsibility: Inline affordance (#181) under an assistant bubble
//                 that surfaces prior superseded replies for the same
//                 persona/provider. Fetch is lazy: history is loaded
//                 on mount; the count drives whether the toggle even
//                 renders. Most bubbles have no history — the
//                 component renders nothing in that case so it stays
//                 invisible.
// History:        Originally read from attempts via
//                 listAttemptHistoryForMessage. Switched to
//                 listMessageHistory (messages.superseded_at) in
//                 #181-followup so it works for the #179-#205
//                 random-attempt-id window too — the legacy lookup
//                 returned [] for any data created in that window.
// Collaborators: lib/persistence/messages.listMessageHistory.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { Message } from "@/lib/types";
import { listMessageHistory } from "@/lib/persistence/messages";

export function AttemptHistory({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}): JSX.Element | null {
  // Count is fetched on mount so the affordance can hide itself when
  // there's no history. A future optimization could push this into
  // the messages store to avoid the per-message round-trip.
  const [count, setCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<Message[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listMessageHistory(conversationId, messageId).then((rows) => {
      if (cancelled) return;
      setCount(rows.length);
      // Cache: expand reveals the already-loaded list rather than re-fetching.
      setHistory(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, messageId]);

  if (count === null || count === 0) return null;

  return (
    <div className="mt-2 text-[11px] text-neutral-500">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="underline hover:text-neutral-800"
        aria-expanded={expanded}
      >
        {expanded ? "hide" : `show ${count} older attempt${count === 1 ? "" : "s"}`}
      </button>
      {expanded && history ? (
        <ul className="mt-2 space-y-2 border-l-2 border-neutral-200 pl-3">
          {history.map((m, idx) => (
            <li key={m.id} className="text-neutral-600">
              <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                attempt {idx + 1}
                {m.errorMessage ? <span className="ml-2 text-red-700">error</span> : null}
                {m.supersededAt ? (
                  <span className="ml-2">
                    superseded {new Date(m.supersededAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-xs">
                {m.errorMessage ? `${m.errorMessage}\n${m.content}` : m.content}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
