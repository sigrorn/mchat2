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
import { userNumberByIndex } from "@/lib/conversations/userMessageNumber";
import { isExcludedByLimit } from "@/lib/context/excluded";
import { useConversationsStore } from "@/stores/conversationsStore";
import { groupIntoColumns } from "@/lib/rendering/columnGroups";

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

  const userNumbers = userNumberByIndex(messages);
  const conversation = useConversationsStore((s) =>
    s.conversations.find((c) => c.id === conversationId),
  );

  const isCols = conversation?.displayMode === "cols";
  const items = isCols ? groupIntoColumns(messages) : messages.map((m) => ({ kind: "row" as const, message: m }));

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto bg-neutral-100 px-4 py-3"
    >
      {items.map((item) => {
        if (item.kind === "row") {
          return (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              personas={personas}
              userNumber={userNumbers.get(item.message.index) ?? null}
              excluded={conversation ? isExcludedByLimit(item.message, conversation) : false}
            />
          );
        }
        // Columns block (#16). One column per audience persona, in
        // the persona-panel sortOrder. Each column shows that
        // persona's reply, or a placeholder if absent.
        const sortedAudience = item.audience
          .map((id) => personas.find((p) => p.id === id))
          .filter((p): p is Persona => !!p)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((p) => p.id);
        const cols = sortedAudience.length > 0 ? sortedAudience : item.audience;
        return (
          <div
            key={item.messages[0]?.id ?? item.audience.join(":")}
            className="mb-3 grid gap-2"
            style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}
          >
            {cols.map((personaKey) => {
              const m = item.messages.find((x) => x.personaId === personaKey);
              if (!m) {
                return (
                  <div
                    key={personaKey}
                    className="rounded border border-dashed border-neutral-300 px-3 py-2 text-xs italic text-neutral-500"
                  >
                    no reply
                  </div>
                );
              }
              return (
                <MessageBubble
                  key={m.id}
                  message={m}
                  personas={personas}
                  userNumber={null}
                  excluded={conversation ? isExcludedByLimit(m, conversation) : false}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function MessageBubble({
  message,
  personas,
  userNumber,
  excluded,
}: {
  message: Message;
  personas: readonly Persona[];
  userNumber: number | null;
  excluded: boolean;
}): JSX.Element {
  // Notice rows (#8): UI-only info/error from in-app commands. Visually
  // distinct, italicized, never reach the LLM.
  if (message.role === "notice") {
    return (
      <div
        role="note"
        className="mb-3 rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm italic text-amber-900 shadow-sm"
      >
        {message.content}
      </div>
    );
  }
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
  } else if (message.role === "user") {
    // [N] prefix is display-only — never written to message.content,
    // never sent to the LLM, never in exports.
    headerParts.push(userNumber !== null ? `[${userNumber}] user` : "user");
  } else {
    headerParts.push(message.role);
  }
  // Excluded rows (#9): muted background + slightly dimmed text so the
  // user can see at a glance which bubbles are below the limit mark
  // and won't reach the LLM. Pinned rows are not marked excluded
  // because they survive the cut.
  const bubbleBg = excluded
    ? "bg-neutral-200/60 text-neutral-700"
    : isAssistant
      ? "bg-white"
      : "bg-blue-50";
  return (
    <div
      data-excluded={excluded ? "true" : undefined}
      data-pinned={message.pinned ? "true" : undefined}
      className={`mb-3 rounded border-l-4 px-3 py-2 shadow-sm ${bubbleBg}`}
      style={{ borderLeftColor: color }}
    >
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {message.pinned ? <span className="mr-1" aria-label="pinned">📌</span> : null}
        {headerParts.join(" · ")}
      </div>
      {message.errorMessage ? (
        <div className="text-sm text-red-700">error: {message.errorMessage}</div>
      ) : (
        <div
          className={`whitespace-pre-wrap text-sm leading-relaxed ${
            excluded ? "text-neutral-600" : "text-neutral-900"
          }`}
        >
          {message.content}
        </div>
      )}
    </div>
  );
}
