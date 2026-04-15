// ------------------------------------------------------------------
// Component: MessageList
// Responsibility: Render message rows. Styling is deliberately simple;
//                 markdown/code-block routing will plug into the
//                 MessageBubble at a later pass.
// ------------------------------------------------------------------

import { useMessagesStore } from "@/stores/messagesStore";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import type { Message } from "@/lib/types";

export function MessageList({ conversationId }: { conversationId: string }): JSX.Element {
  const messages = useMessagesStore((s) => s.byConversation[conversationId] ?? []);
  return (
    <div className="flex-1 overflow-auto px-4 py-3">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }): JSX.Element {
  const isAssistant = message.role === "assistant";
  const color = isAssistant && message.provider ? PROVIDER_COLORS[message.provider] : "#1f2937";
  return (
    <div
      className={`mb-3 rounded border-l-4 bg-white px-3 py-2 shadow-sm ${isAssistant ? "" : "bg-neutral-50"}`}
      style={{ borderLeftColor: color }}
    >
      <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
        {message.role}
        {message.provider ? ` · ${message.provider}` : ""}
        {message.model ? ` · ${message.model}` : ""}
      </div>
      {message.errorMessage ? (
        <div className="text-sm text-red-700">error: {message.errorMessage}</div>
      ) : (
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
      )}
    </div>
  );
}
