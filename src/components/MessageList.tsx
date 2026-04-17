// ------------------------------------------------------------------
// Component: MessageList
// Responsibility: Render message rows. Styling is deliberately simple;
//                 markdown/code-block routing will plug into the
//                 MessageBubble at a later pass.
// ------------------------------------------------------------------

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import type { Message, Persona } from "@/lib/types";
import { isPinnedToBottom } from "./scrollPin";
import { userNumberByIndex } from "@/lib/conversations/userMessageNumber";
import { isExcludedByLimit } from "@/lib/context/excluded";
import { useConversationsStore } from "@/stores/conversationsStore";
import { groupIntoColumns } from "@/lib/rendering/columnGroups";
import { formatUserHeader } from "@/lib/conversations/userHeader";
import { renderMessageBody } from "@/lib/rendering/messageBody";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSend } from "@/hooks/useSend";
import { useUiStore } from "@/stores/uiStore";
import { truncateToFit, estimateTokens } from "@/lib/context/truncate";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);

const EMPTY: readonly Message[] = Object.freeze([]);

export function MessageList({
  conversationId,
  activeMatchMessageId = null,
}: {
  conversationId: string;
  activeMatchMessageId?: string | null;
}): JSX.Element {
  const messages = useMessagesStore((s) => s.byConversation[conversationId]) ?? EMPTY;
  const personas = usePersonasStore((s) => s.byConversation[conversationId]) ?? EMPTY_PERSONAS;
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
  const items = isCols
    ? groupIntoColumns(messages)
    : messages.map((m) => ({ kind: "row" as const, message: m }));

  // #43/#44: useSend exposes retry + replay for failed-row retry and
  // user-row edit+replay. Needs the full Conversation object, which
  // we already have from the store above.
  const { retry, replay } = useSend(
    conversation ?? {
      id: conversationId,
      title: "",
      systemPrompt: null,
      createdAt: 0,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitSizeTokens: null,
    },
  );
  // #47: editing state lives in messagesStore so the Composer's
  // //edit command dispatcher can open the inline editor too.
  const editingId = useMessagesStore((s) => s.editingByConversation[conversationId] ?? null);
  const setEditingId = (id: string | null): void => {
    useMessagesStore.getState().setEditing(conversationId, id);
  };

  // #64: compute the effective sliding-window limit index so shading
  // reflects limitSizeTokens. Reuse the same truncateToFit that
  // buildContext uses at send time — run it with the tightest budget
  // across active personas. The result's firstSurvivingUserNumber
  // maps back to an index via userNumbers.
  const effectiveLimitIndex = (() => {
    if (!conversation?.limitSizeTokens) return null;
    const tightest = Math.min(
      conversation.limitSizeTokens,
      ...personas.map((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens),
    );
    if (!Number.isFinite(tightest)) return null;
    // Build a rough ChatMessage[] from the visible messages.
    const chatMsgs = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.content)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const infos = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.content)
      .map((m) => ({
        pinned: m.pinned,
        userNumber: m.role === "user" ? (userNumbers.get(m.index) ?? null) : null,
      }));
    const systemEst = conversation.systemPrompt ? estimateTokens(conversation.systemPrompt) * 4 : 0;
    const r = truncateToFit(
      conversation.systemPrompt ? "x".repeat(systemEst) : null,
      chatMsgs,
      tightest,
      infos,
    );
    if (r.dropped === 0 || r.firstSurvivingUserNumber === null) return null;
    // Map the user number back to an index.
    for (const [idx, num] of userNumbers) {
      if (num === r.firstSurvivingUserNumber) return idx;
    }
    return null;
  })();

  // #50: chat-pane font scale (Ctrl+/-/0). Applied as inline fontSize
  // so all descendant text (bubble headers, markdown body, notices)
  // scales together via em-based sizing inside the styled elements.
  const fontScale = useUiStore((s) => s.chatFontScale);

  // #53: when the find bar sets a new active match, scroll its bubble
  // into view. Also temporarily unpin tail-follow so the scroll sticks.
  useEffect(() => {
    if (!activeMatchMessageId) return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${activeMatchMessageId}"]`,
    );
    if (el) {
      pinnedRef.current = false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeMatchMessageId]);

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto bg-neutral-100 px-4 py-3"
      style={{ fontSize: `${fontScale * 100}%` }}
    >
      {items.map((item) => {
        if (item.kind === "row") {
          const m = item.message;
          if (editingId === m.id && m.role === "user") {
            return (
              <EditReplayEditor
                key={m.id}
                initial={m.content}
                onCancel={() => setEditingId(null)}
                onCommit={async (next) => {
                  setEditingId(null);
                  const trimmed = next.trim();
                  if (!trimmed || trimmed === m.content) return;
                  await replay(m.id, trimmed);
                }}
              />
            );
          }
          const bubbleProps = {
            key: m.id,
            message: m,
            personas,
            userNumber: userNumbers.get(m.index) ?? null,
            excluded: conversation ? isExcludedByLimit(m, conversation, effectiveLimitIndex) : false,
            onRetry: () => void retry(m),
            ...(m.role === "user" ? { onEdit: () => setEditingId(m.id) } : {}),
          };
          return <MessageBubble {...bubbleProps} />;
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
                  onRetry={() => void retry(m)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function EditReplayEditor({
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
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
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
        <button
          onClick={() => void onCommit(value)}
          className="rounded bg-neutral-900 px-2 py-0.5 text-xs text-white hover:bg-neutral-700"
        >
          Replay (Ctrl+Enter)
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
        >
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
}

// #63: render #N patterns in notice text as clickable scroll-links.
function NoticeContent({ content }: { content: string }): JSX.Element {
  const messages = useMessagesStore((s) => s.byConversation) as Record<string, Message[]>;
  const parts = content.split(/(#\d+)/g);
  if (parts.length === 1) return <>{content}</>;
  return (
    <>
      {parts.map((part, i) => {
        const m = /^#(\d+)$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const userNum = Number(m[1]);
        return (
          <button
            key={i}
            className="not-italic font-semibold text-amber-800 underline hover:text-amber-600"
            title={`Scroll to message #${userNum}`}
            onClick={() => {
              // Find the message with this user number across all loaded convs.
              for (const msgs of Object.values(messages)) {
                const userNumbers = userNumberByIndex(msgs);
                for (const [idx, num] of userNumbers) {
                  if (num === userNum) {
                    const msg = msgs.find((x) => x.index === idx);
                    if (msg) {
                      const el = document.querySelector<HTMLElement>(
                        `[data-message-id="${msg.id}"]`,
                      );
                      el?.scrollIntoView({ block: "center", behavior: "smooth" });
                    }
                    return;
                  }
                }
              }
            }}
          >
            {part}
          </button>
        );
      })}
    </>
  );
}

function renderBubbleBody(message: Message, excluded: boolean): JSX.Element {
  const body = renderMessageBody(message);
  const tone = excluded ? "text-neutral-600" : "text-neutral-900";
  if (body.kind === "html") {
    // Use react-markdown + remark-gfm for assistant rows so tables,
    // strikethrough, task lists, etc. all render correctly. The old
    // custom renderer (rendering/markdown.ts) stays in place for
    // HTML export where a React tree isn't available.
    return (
      <div className={`markdown-body text-sm leading-relaxed ${tone}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    );
  }
  return <div className={`whitespace-pre-wrap text-sm leading-relaxed ${tone}`}>{body.text}</div>;
}

function MessageBubble({
  message,
  personas,
  userNumber,
  excluded,
  onRetry,
  onEdit,
}: {
  message: Message;
  personas: readonly Persona[];
  userNumber: number | null;
  excluded: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
}): JSX.Element {
  // Notice rows (#8): UI-only info/error from in-app commands. Visually
  // distinct, italicized, never reach the LLM.
  if (message.role === "notice") {
    return (
      <div
        role="note"
        data-message-id={message.id}
        className="mb-3 whitespace-pre-wrap rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm italic text-amber-900 shadow-sm"
      >
        <NoticeContent content={message.content} />
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
    headerParts.push(formatUserHeader(userNumber, message.addressedTo, personas));
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
      data-message-id={message.id}
      className={`mb-3 rounded border-l-4 px-3 py-2 shadow-sm ${bubbleBg}`}
      style={{ borderLeftColor: color }}
    >
      <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-neutral-600">
        <div>
          {message.pinned ? (
            <span className="mr-1" aria-label="pinned">
              📌
            </span>
          ) : null}
          {headerParts.join(" · ")}
        </div>
        {onEdit ? (
          <button
            onClick={onEdit}
            className="ml-2 rounded border border-neutral-300 px-1.5 py-0 text-[10px] font-normal normal-case text-neutral-500 hover:bg-neutral-100"
            title="Edit this message and regenerate replies"
          >
            edit
          </button>
        ) : null}
      </div>
      {message.errorMessage ? (
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-red-700">error: {message.errorMessage}</div>
          {onRetry && message.role === "assistant" ? (
            <button
              onClick={onRetry}
              className="shrink-0 rounded border border-red-600 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
              title="Retry this request with the same persona and context"
            >
              retry
            </button>
          ) : null}
        </div>
      ) : (
        renderBubbleBody(message, excluded)
      )}
    </div>
  );
}
