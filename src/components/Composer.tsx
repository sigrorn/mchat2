// ------------------------------------------------------------------
// Component: Composer
// Responsibility: Text area + send/cancel buttons. Delegates all send
//                 logic to useSend.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Conversation } from "@/lib/types";
import { useSend } from "@/hooks/useSend";
import { useSendStore, type ActiveStream } from "@/stores/sendStore";
import { shouldSubmit } from "./composerKeys";

const EMPTY_ACTIVE: readonly ActiveStream[] = Object.freeze([]);

export function Composer({ conversation }: { conversation: Conversation }): JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const { send } = useSend(conversation);
  const active =
    useSendStore((s) => s.activeByConversation[conversation.id]) ?? EMPTY_ACTIVE;

  const onSend = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setHint(null);
    const t = text;
    // Optimistically clear so the next keystrokes don't race with a
    // failed send. If send rejects 'no targets', we restore the text
    // so the user doesn't lose what they typed (#7).
    setText("");
    try {
      const result = await send(t);
      if (!result.ok) {
        setText(t);
        setHint(
          result.reason === "no targets"
            ? "No persona selected. Use @name (or @all) to address one, then it stays sticky for follow-ups."
            : `Could not send: ${result.reason}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onCancel = (): void => {
    useSendStore.getState().cancelAll(conversation.id);
  };

  return (
    <div className="border-t border-neutral-200 p-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (shouldSubmit(e)) {
            e.preventDefault();
            void onSend();
          }
        }}
        rows={3}
        placeholder="Type a message. Use @alice @all @others to target personas. Enter to send, Shift+Enter for newline."
        className="w-full resize-y rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
      {hint ? (
        <div className="mt-2 text-xs text-amber-700">{hint}</div>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void onSend()}
          disabled={busy || !text.trim()}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Send
        </button>
        {active.length > 0 ? (
          <button
            onClick={onCancel}
            className="rounded border border-red-600 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            Cancel ({active.length})
          </button>
        ) : null}
      </div>
    </div>
  );
}
