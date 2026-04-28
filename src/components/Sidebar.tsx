// ------------------------------------------------------------------
// Component: Sidebar
// Responsibility: Layout shell that hosts the conversation list and
//                 footer (settings + toggles). Extracted under #167 —
//                 export handlers moved to useConversationExports;
//                 settings/toggles moved to SidebarFooter; the inline
//                 rename input lives in RenameEditor.
// Collaborators: SidebarFooter, useConversationExports, ContextMenu,
//                conversationsStore, uiStore.
// ------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useUiStore } from "@/stores/uiStore";
import { useRepoQuery } from "@/lib/data/useRepoQuery";
import * as conversationsRepo from "@/lib/persistence/conversations";
import type { Conversation } from "@/lib/types";
import { keychain } from "@/lib/tauri/keychain";
import { ContextMenu } from "./ContextMenu";
import { useMessagesStore } from "@/stores/messagesStore";
import { SidebarFooter } from "./SidebarFooter";
import { useConversationExports } from "./useConversationExports";
import { OutlineButton, PrimaryButton, DangerButton } from "@/components/ui/Button";

const EMPTY_CONVERSATIONS: readonly Conversation[] = Object.freeze([]) as readonly Conversation[];

interface MenuPos {
  id: string;
  x: number;
  y: number;
}

export function Sidebar(): JSX.Element {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  if (collapsed) {
    return (
      <aside className="flex w-5 flex-col items-center border-r border-neutral-200 bg-neutral-50">
        <button
          onClick={toggle}
          title="Expand conversations panel"
          aria-label="Expand conversations panel"
          className="mt-2 text-sm text-neutral-500 hover:text-neutral-900"
        >
          ›
        </button>
      </aside>
    );
  }
  return <SidebarExpanded onCollapse={toggle} />;
}

function SidebarExpanded({ onCollapse }: { onCollapse: () => void }): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuPos | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // #186/#211: conversations come from useRepoQuery. The cache is
  // seeded by conversationsStore.load() and updated in-place by every
  // store mutation, so consumers see updates without re-fetching.
  const conversationsQuery = useRepoQuery<Conversation[]>(
    ["conversations"],
    () => conversationsRepo.listConversations(),
  );
  const conversations = conversationsQuery.data ?? EMPTY_CONVERSATIONS;
  const currentId = useConversationsStore((s) => s.currentId);
  const select = useConversationsStore((s) => s.select);
  const create = useConversationsStore((s) => s.create);
  const rename = useConversationsStore((s) => s.rename);
  const removeConv = useConversationsStore((s) => s.remove);
  const exports = useConversationExports();

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
      autocompactThreshold: null,
      contextWarningsFired: [],
    });
    const keys = await keychain.list();
    const hasKeys = keys.length > 0;
    const msg = hasKeys
      ? "Add some personas to get started. Use //help for a list of available commands."
      : "Add at least one LLM API key in Settings, then add some personas to get started. Use //help for a list of available commands.";
    await useMessagesStore.getState().appendNotice(conv.id, msg);
  };

  return (
    <aside className="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50">
      <div className="flex justify-end px-2 pt-1">
        <button
          onClick={onCollapse}
          title="Collapse conversations panel"
          aria-label="Collapse conversations panel"
          className="text-sm text-neutral-400 hover:text-neutral-900"
        >
          ‹
        </button>
      </div>
      <div className="m-2 mt-1 flex gap-2">
        <PrimaryButton onClick={onNew} size="lg" className="flex-1">
          New conversation
        </PrimaryButton>
        <OutlineButton
          onClick={() => void exports.importSnapshot()}
          size="sm"
          className="py-2"
          title="Import snapshot"
        >
          Import
        </OutlineButton>
      </div>
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
                <DangerButton
                  onClick={async () => {
                    await removeConv(c.id);
                    setConfirmDelete(null);
                  }}
                  size="xs"
                >
                  Delete
                </DangerButton>
                <OutlineButton onClick={() => setConfirmDelete(null)} size="xs">
                  Cancel
                </OutlineButton>
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
            { label: "Rename", onSelect: () => setEditingId(menu.id) },
            { label: "Export to HTML", onSelect: () => void exports.exportHtml(menu.id) },
            {
              label: "Export to Markdown",
              onSelect: () => void exports.exportMarkdown(menu.id),
            },
            { label: "Take snapshot", onSelect: () => void exports.takeSnapshot(menu.id) },
            {
              label: "Delete",
              destructive: true,
              onSelect: () => setConfirmDelete(menu.id),
            },
          ]}
        />
      ) : null}
      <SidebarFooter />
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
