// ------------------------------------------------------------------
// Component: ChatView
// Responsibility: Compose MessageList + Composer for the selected
//                 conversation. Loads per-conversation state on mount.
// ------------------------------------------------------------------

import { useEffect, useMemo } from "react";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useUiStore } from "@/stores/uiStore";
import { findMatches } from "@/lib/ui/findMatches";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { PersonaPanel } from "./PersonaPanel";
import { MatrixPanel } from "./MatrixPanel";
import { FindBar } from "./FindBar";
import type { Message } from "@/lib/types";

const EMPTY: readonly Message[] = Object.freeze([]);

export function ChatView(): JSX.Element {
  const currentId = useConversationsStore((s) => s.currentId);
  const conversation = useConversationsStore((s) =>
    s.conversations.find((c) => c.id === s.currentId),
  );
  const loadMessages = useMessagesStore((s) => s.load);
  const loadPersonas = usePersonasStore((s) => s.load);

  useEffect(() => {
    if (!currentId) return;
    void loadMessages(currentId);
    void loadPersonas(currentId);
  }, [currentId, loadMessages, loadPersonas]);

  // #53: compute matches for the find bar from the active conversation.
  // Hook order requires these before any early return; message list is
  // the empty-frozen constant when the conversation doesn't exist yet.
  const messages = useMessagesStore(
    (s) => (conversation ? s.byConversation[conversation.id] : undefined) ?? EMPTY,
  );
  const find = useUiStore((s) => s.find);
  const matches = useMemo(
    () => (find.open ? findMatches(messages, find.query, find.caseSensitive) : []),
    [find.open, find.query, find.caseSensitive, messages],
  );
  const activeMatch = matches[find.activeIndex] ?? null;

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-neutral-400">
        Select or create a conversation.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-1">
      <div className="flex flex-1 flex-col">
        <header className="border-b border-neutral-200 px-4 py-2 text-sm font-medium">
          {conversation.title}
        </header>
        <FindBar matchCount={matches.length} />
        <MessageList
          conversationId={conversation.id}
          activeMatchMessageId={activeMatch?.messageId ?? null}
        />
        <MatrixPanel conversation={conversation} />
        <Composer conversation={conversation} />
      </div>
      <PersonaPanel conversation={conversation} />
    </div>
  );
}
