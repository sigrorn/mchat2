// ------------------------------------------------------------------
// Component: Sidebar
// Responsibility: Conversation list + new-conversation button. Pure
//                 presentation — drives the conversationsStore.
// ------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useConversationsStore } from "@/stores/conversationsStore";
import { SettingsDialog } from "./SettingsDialog";
import { SettingsGeneralDialog } from "./SettingsGeneralDialog";
import { useUiStore } from "@/stores/uiStore";
import { keychain } from "@/lib/tauri/keychain";
import { ContextMenu } from "./ContextMenu";
import {
  exportConversationToHtml,
  exportConversationToMarkdown,
} from "@/lib/conversations/exportToFile";
import * as messagesRepo from "@/lib/persistence/messages";
import * as personasRepo from "@/lib/persistence/personas";
import { useMessagesStore } from "@/stores/messagesStore";

interface MenuPos {
  id: string;
  x: number;
  y: number;
}

export function Sidebar(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generalOpen, setGeneralOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const conversations = useConversationsStore((s) => s.conversations);
  const currentId = useConversationsStore((s) => s.currentId);
  const select = useConversationsStore((s) => s.select);
  const create = useConversationsStore((s) => s.create);
  const rename = useConversationsStore((s) => s.rename);
  const removeConv = useConversationsStore((s) => s.remove);

  const onNew = async (): Promise<void> => {
    const conv = await create({
      title: "New conversation",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "joined",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: [],
      compactionFloorIndex: null,
    });
    const keys = await keychain.list();
    const hasKeys = keys.length > 0;
    const msg = hasKeys
      ? "Add some personas to get started. Use //help for a list of available commands."
      : "Add at least one LLM API key in Settings, then add some personas to get started. Use //help for a list of available commands.";
    await useMessagesStore.getState().appendNotice(conv.id, msg);
  };

  const getExportData = async (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return null;
    const [messages, personas] = await Promise.all([
      messagesRepo.listMessages(id),
      personasRepo.listPersonas(id, true),
    ]);
    return { conversation: conv, messages, personas, generatedAt: new Date().toISOString() };
  };

  const exportHtml = async (id: string): Promise<void> => {
    const data = await getExportData(id);
    if (!data) return;
    const r = await exportConversationToHtml(data);
    if (r.ok) await useMessagesStore.getState().appendNotice(id, `exported to ${r.path}.`);
  };

  const exportMarkdown = async (id: string): Promise<void> => {
    const data = await getExportData(id);
    if (!data) return;
    const r = await exportConversationToMarkdown(data);
    if (r.ok) await useMessagesStore.getState().appendNotice(id, `exported to ${r.path}.`);
  };

  return (
    <aside className="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50">
      <button
        onClick={onNew}
        className="m-2 rounded bg-neutral-900 px-3 py-2 text-sm text-white hover:bg-neutral-700"
      >
        New conversation
      </button>
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
            ) : confirmDelete === c.id ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="text-neutral-700">Delete?</span>
                <button
                  onClick={async () => {
                    await removeConv(c.id);
                    setConfirmDelete(null);
                  }}
                  className="rounded border border-red-600 px-2 py-0.5 text-red-700 hover:bg-red-50"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="rounded border border-neutral-300 px-2 py-0.5 text-neutral-700 hover:bg-neutral-100"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => select(c.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ id: c.id, x: e.clientX, y: e.clientY });
                }}
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
      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel="Conversation actions"
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Rename",
              onSelect: () => setEditingId(menu.id),
            },
            {
              label: "Export to HTML",
              onSelect: () => {
                void exportHtml(menu.id);
              },
            },
            {
              label: "Export to Markdown",
              onSelect: () => {
                void exportMarkdown(menu.id);
              },
            },
            {
              label: "Delete",
              destructive: true,
              onSelect: () => setConfirmDelete(menu.id),
            },
          ]}
        />
      ) : null}
      <button
        onClick={() => setGeneralOpen(true)}
        className="mx-2 mt-2 rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
      >
        Settings · General
      </button>
      <button
        onClick={() => setSettingsOpen(true)}
        className="mx-2 mt-1 rounded border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100"
      >
        Settings · API keys
      </button>
      <DebugToggle />
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {generalOpen ? <SettingsGeneralDialog onClose={() => setGeneralOpen(false)} /> : null}
    </aside>
  );
}

function DebugToggle(): JSX.Element {
  const workingDir = useUiStore((s) => s.workingDir);
  const debug = useUiStore((s) => s.debugSession);
  const toggle = useUiStore((s) => s.toggleDebug);
  const disabled = !workingDir;
  const label = disabled
    ? "Debug · (set working directory first)"
    : debug.enabled
      ? `Debug · ON (${debug.sessionTimestamp})`
      : "Debug · OFF";
  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`mx-2 mb-2 mt-1 rounded border px-3 py-1.5 text-xs ${
        debug.enabled
          ? "border-green-600 text-green-700 hover:bg-green-50"
          : disabled
            ? "border-neutral-200 text-neutral-400"
            : "border-neutral-300 text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
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
