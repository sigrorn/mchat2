// ------------------------------------------------------------------
// Component: EditReplayEditor
// Responsibility: Inline textarea opened when the user clicks 'edit'
//                 on a user message (#43, #44). Submits via the same
//                 keys as the composer (#134). Extracted from
//                 MessageList.tsx in #167.
// Collaborators: MessageList (parent), composerKeys.shouldSubmit.
// ------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { shouldSubmit } from "./composerKeys";
import { OutlineButton, PrimaryButton } from "@/components/ui/Button";

export function EditReplayEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="mb-3 rounded border-l-4 border-blue-400 bg-blue-50 px-3 py-2 shadow-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        edit &amp; replay
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // #134 — same submit policy as the composer: Enter submits,
          // Shift-Enter inserts a newline, Ctrl/Cmd-Enter also submit.
          if (shouldSubmit(e)) {
            e.preventDefault();
            void onCommit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={Math.max(3, Math.min(12, value.split("\n").length + 1))}
        className="block w-full resize-y rounded border border-neutral-300 px-2 py-1.5 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <PrimaryButton onClick={() => void onCommit(value)} size="xs">
          Replay (Enter)
        </PrimaryButton>
        <OutlineButton onClick={onCancel} size="xs">
          Cancel (Esc)
        </OutlineButton>
      </div>
    </div>
  );
}
