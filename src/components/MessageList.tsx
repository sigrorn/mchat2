// ------------------------------------------------------------------
// Component: MessageList
// Responsibility: Container for the message stream. Owns column-vs-row
//                 layout decision, the find-scroll-into-view effect,
//                 and the edit-replay editor toggle. Tail-follow scroll
//                 behavior lives in useScrollPin; row presentation is
//                 in MessageBubble; the inline edit textarea is in
//                 EditReplayEditor — split out under #167 so this file
//                 stays a list/coordinator rather than a 500-line
//                 catch-all.
// Collaborators: MessageBubble, EditReplayEditor, useScrollPin,
//                useSend, conversationsStore, messagesStore,
//                personasStore.
// ------------------------------------------------------------------

import { useEffect, useRef, type RefObject } from "react";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import type { Message, Persona } from "@/lib/types";
import { userNumberByIndex } from "@/lib/conversations/userMessageNumber";
import { isExcludedByLimit } from "@/lib/context/excluded";
import { useConversationsStore } from "@/stores/conversationsStore";
import { groupIntoColumns } from "@/lib/rendering/columnGroups";
import { formatCopyText } from "@/lib/rendering/copyWithPrefixes";
import { useSend } from "@/hooks/useSend";
import { truncateToFit, estimateTokens } from "@/lib/context/truncate";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { MessageBubble } from "./MessageBubble";
import { EditReplayEditor } from "./EditReplayEditor";
import { useScrollPin } from "./useScrollPin";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);
const EMPTY: readonly Message[] = Object.freeze([]);

export function MessageList({
  conversationId,
  activeMatchMessageId = null,
  scrollContainerRef,
  pinnedRef: pinnedRefProp,
  onScroll: onScrollProp,
}: {
  conversationId: string;
  activeMatchMessageId?: string | null;
  // #137: when the parent (ChatView) needs the scroll container — for
  // the header's prev/next user-message arrows — it forwards a ref.
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  // #137: parent can also share the tail-pin flag so a programmatic
  // scroll initiated from outside (the header arrows) can mark the
  // container unpinned before the scroll, preventing the layout
  // effect from yanking back to the bottom.
  pinnedRef?: React.MutableRefObject<boolean>;
  onScroll?: () => void;
}): JSX.Element {
  const messages = useMessagesStore((s) => s.byConversation[conversationId]) ?? EMPTY;
  const personas = usePersonasStore((s) => s.byConversation[conversationId]) ?? EMPTY_PERSONAS;
  const internalRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollContainerRef ?? internalRef;
  const { pinnedRef, onScroll } = useScrollPin(containerRef, pinnedRefProp, onScrollProp);

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
      selectedPersonas: [],
      compactionFloorIndex: null,
      autocompactThreshold: null,
      contextWarningsFired: [],
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
    for (const [idx, num] of userNumbers) {
      if (num === r.firstSurvivingUserNumber) return idx;
    }
    return null;
  })();

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
  }, [activeMatchMessageId, containerRef, pinnedRef]);

  const onCopy = (e: React.ClipboardEvent): void => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const container = containerRef.current;
    if (!container) return;
    const selectedIds = new Set<string>();
    const bubbles = container.querySelectorAll<HTMLElement>("[data-message-id]");
    for (const el of bubbles) {
      if (sel.containsNode(el, true)) {
        const id = el.dataset.messageId;
        if (id) selectedIds.add(id);
      }
    }
    if (selectedIds.size === 0) return;
    const selected = messages.filter((m) => selectedIds.has(m.id));
    if (selected.length <= 1) return;
    e.preventDefault();
    const text = formatCopyText(selected, personas);
    e.clipboardData.setData("text/plain", text);
  };

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      onCopy={onCopy}
      className="flex-1 overflow-auto bg-neutral-100 px-4 py-3"
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
            excluded: conversation
              ? isExcludedByLimit(m, conversation, effectiveLimitIndex)
              : false,
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
