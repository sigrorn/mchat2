// ------------------------------------------------------------------
// Component: MessageList
// Responsibility: Render message rows. Styling is deliberately simple;
//                 markdown/code-block routing will plug into the
//                 MessageBubble at a later pass.
// ------------------------------------------------------------------

import { useLayoutEffect, useRef } from "react";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import type { Message, Persona } from "@/lib/types";
import { isPinnedToBottom } from "./scrollPin";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);

const EMPTY: readonly Message[] = Object.freeze([]);

export function MessageList({ conversationId }: { conversationId: string }): JSX.Element {
  const messages =
    useMessagesStore((s) => s.byConversation[conversationId]) ?? EMPTY;
  const personas =
    usePersonasStore((s) => s.byConversation[conversationId]) ?? EMPTY_PERSONAS;
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Re-check pin status on every user-driven scroll. Cheap and avoids
  // the trap where we mistake an auto-scroll for a manual one.
  const onScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = isPinnedToBottom({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    });
  };

  // Layout effect runs synchronously after DOM mutation, before paint —
  // critical for the no-jump experience: the user never sees an
  // intermediate frame where new content is below the fold.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  });

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto bg-neutral-100 px-4 py-3"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} personas={personas} />
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  personas,
}: {
  message: Message;
  personas: readonly Persona[];
}): JSX.Element {
  const isAssistant = message.role === "assistant";
  const persona = message.personaId ? personas.find((p) => p.id === message.personaId) : null;
  const color = isAssistant
    ? (persona?.colorOverride ?? (message.provider ? PROVIDER_COLORS[message.provider] : "#1f2937"))
    : "#1f2937";
  const headerParts: string[] = [];
  if (isAssistant) {
    if (persona) headerParts.push(persona.name);
    else headerParts.push("assistant");
    if (message.provider) headerParts.push(message.provider);
    if (message.model) headerParts.push(message.model);
  } else {
    headerParts.push(message.role);
  }
  return (
    <div
      className={`mb-3 rounded border-l-4 px-3 py-2 text-neutral-900 shadow-sm ${
        isAssistant ? "bg-white" : "bg-blue-50"
      }`}
      style={{ borderLeftColor: color }}
    >
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {headerParts.join(" · ")}
      </div>
      {message.errorMessage ? (
        <div className="text-sm text-red-700">error: {message.errorMessage}</div>
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-900">
          {message.content}
        </div>
      )}
    </div>
  );
}
