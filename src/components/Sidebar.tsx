// ------------------------------------------------------------------
// Component: Sidebar
// Responsibility: Conversation list + new-conversation button. Pure
//                 presentation — drives the conversationsStore.
// ------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useConversationsStore } from "@/stores/conversationsStore";
import { SettingsDialog } from "./SettingsDialog";

export function Sidebar(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const conversations = useConversationsStore((s) => s.conversations);
  const currentId = useConversationsStore((s) => s.currentId);
  const select = useConversationsStore((s) => s.select);
  const create = useConversationsStore((s) => s.create);
  const rename = useConversationsStore((s) => s.rename);

  const onNew = async (): Promise<void> => {
    await create({
      title: "New conversation",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
    });
  };

  return (
    <aside className="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50">
      <button
        onClick={onNew}
        className="m-2 rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700"
      >
        New conversation
      </button>
      <button
        onClick={() => setSettingsOpen(true)}
        className="mx-2 mb-2 rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
      >
        Settings · API keys
      </button>
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      <ul className="flex-1 overflow-auto">
        {conversations.map((c) => (
          <li key={c.id}>
            {editingId === c.id ? (
              <RenameEditor
                initial={c.title}
                onCommit={async (next) => {
                  try {
                    await rename(c.id, next);
                  } catch {
                    // Empty/whitespace title — ignore; caller cancels.
                  }
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <button
                onClick={() => select(c.id)}
                onDoubleClick={() => setEditingId(c.id)}
                className={`block w-full truncate px-3 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-200 ${
                  currentId === c.id ? "bg-neutral-200 font-medium" : ""
                }`}
              >
                {c.title}
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function RenameEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label="Rename conversation"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") void onCommit(value);
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={() => void onCommit(value)}
      className="block w-full truncate px-3 py-2 text-left text-sm text-neutral-900"
    />
  );
}
