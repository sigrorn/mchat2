// ------------------------------------------------------------------
// Component: Composer
// Responsibility: Text area + send/cancel buttons. Delegates all send
//                 logic to useSend.
// ------------------------------------------------------------------

import { useState } from "react";
import type { Conversation } from "@/lib/types";
import { useSend } from "@/hooks/useSend";
import { useSendStore } from "@/stores/sendStore";

export function Composer({ conversation }: { conversation: Conversation }): JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { send } = useSend(conversation);
  const active = useSendStore((s) => s.activeByConversation[conversation.id] ?? []);

  const onSend = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const t = text;
    setText("");
    try {
      await send(t);
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
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void onSend();
        }}
        rows={3}
        placeholder="Type a message. Use @alice @all @others to target personas. Ctrl+Enter to send."
        className="w-full resize-y rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
      />
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
