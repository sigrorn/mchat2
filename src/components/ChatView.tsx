// ------------------------------------------------------------------
// Component: ChatView
// Responsibility: Compose MessageList + Composer for the selected
//                 conversation. Loads per-conversation state on mount.
// ------------------------------------------------------------------

import { useEffect } from "react";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

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

  if (!conversation) {
    return (
      <div className="flex h-full flex-1 items-center justify-center text-neutral-400">
        Select or create a conversation.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 px-4 py-2 text-sm font-medium">
        {conversation.title}
      </header>
      <MessageList conversationId={conversation.id} />
      <Composer conversation={conversation} />
    </div>
  );
}
