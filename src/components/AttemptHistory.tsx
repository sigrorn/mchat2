// ------------------------------------------------------------------
// Component: AttemptHistory
// Responsibility: Inline affordance (#181) under an assistant bubble
//                 that surfaces superseded attempts on the same
//                 target_key. Fetch is lazy: history is loaded on
//                 first expand, not on every render. Today most rows
//                 have no history — the component renders nothing in
//                 that case so it's invisible to the existing UI.
// Collaborators: lib/persistence/runs.listAttemptHistoryForMessage.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { Attempt } from "@/lib/types";
import { listAttemptHistoryForMessage } from "@/lib/persistence/runs";

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
  const [history, setHistory] = useState<Attempt[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listAttemptHistoryForMessage(conversationId, messageId).then((attempts) => {
      if (cancelled) return;
      setCount(attempts.length);
      // Cache: expand reveals the already-loaded list rather than re-fetching.
      setHistory(attempts);
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
          {history.map((a) => (
            <li key={a.id} className="text-neutral-600">
              <div className="text-[10px] uppercase tracking-wide text-neutral-400">
                attempt {a.sequence}
                {a.errorMessage ? <span className="ml-2 text-red-700">error</span> : null}
                {a.supersededAt ? (
                  <span className="ml-2">
                    superseded {new Date(a.supersededAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-xs">
                {a.errorMessage ? `${a.errorMessage}\n${a.content}` : a.content}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
