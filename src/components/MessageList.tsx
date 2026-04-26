// ------------------------------------------------------------------
// Component: MessageList
// Responsibility: Container for the message stream. Owns column-vs-row
//                 layout decision, the find-scroll-into-view effect,
//                 and the edit-replay editor toggle. Tail-follow scroll
//                 behavior lives in useScrollPin; row presentation is
//                 in MessageBubble; the inline edit textarea is in
//                 EditReplayEditor — split out under #167 so this file
//                 stays a list/coordinator. Items are rendered through
//                 @tanstack/react-virtual under #128 so a 5k-message
//                 conversation only mounts the visible window.
// Collaborators: MessageBubble, EditReplayEditor, useScrollPin,
//                useSend, conversationsStore, messagesStore,
//                personasStore.
// ------------------------------------------------------------------

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
import { filterSupersededMessages } from "@/lib/orchestration/filterSupersededMessages";
import { MessageBubble } from "./MessageBubble";
import { EditReplayEditor } from "./EditReplayEditor";
import { useScrollPin } from "./useScrollPin";

const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);
const EMPTY: readonly Message[] = Object.freeze([]);
const EMPTY_SUPERSEDED: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

// Estimated row height, used by the virtualizer until each row's real
// height is measured. Chat bubbles vary widely (1-line user messages
// vs. multi-paragraph assistant replies with code blocks), so the
// estimate's job is just to scale the scroll spacer reasonably during
// the first paint — the ResizeObserver via measureElement corrects it
// per row as the user scrolls.
const ESTIMATED_ROW_HEIGHT = 120;

// Overscan = how many rows above/below the visible window stay
// mounted. Bigger overscan = less mount churn at scroll boundaries
// but more work per render. 6 keeps the streaming row, the in-context
// rows, and one screen of buffer in DOM at typical viewport sizes.
const OVERSCAN = 6;

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
  const rawMessages = useMessagesStore((s) => s.byConversation[conversationId]) ?? EMPTY;
  const supersededIds =
    useMessagesStore((s) => s.supersededByConversation[conversationId]) ?? EMPTY_SUPERSEDED;
  // #180: drop assistant rows whose Attempt has been superseded by a
  // later one. Today this is a no-op (retry/replay still delete prior
  // rows; supersededIds is empty); the filter is in place so the moment
  // those deletions stop, the UI hides the old rows automatically.
  const messages = useMemo(
    () => filterSupersededMessages(rawMessages, supersededIds),
    [rawMessages, supersededIds],
  );
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

  // Stable keys for the virtualizer — keying by message id (rows) and
  // by the column-group's first message id (cols). Without stable
  // keys, react-virtual would re-measure every item whenever the
  // items array reference changes (which is every render).
  const itemKey = (idx: number): string => {
    const item = items[idx];
    if (!item) return `gap:${idx}`;
    if (item.kind === "row") return `row:${item.message.id}`;
    return `cols:${item.messages[0]?.id ?? item.audience.join(":")}`;
  };

  // Map message id → item index, for find-scroll.
  const itemIndexByMessageId = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((item, idx) => {
      if (item.kind === "row") m.set(item.message.id, idx);
      else for (const msg of item.messages) m.set(msg.id, idx);
    });
    return m;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: itemKey,
    overscan: OVERSCAN,
  });

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

  // #53: when the find bar sets a new active match, scroll the
  // matching bubble into view. With virtualization the target row may
  // not be mounted yet, so we use scrollToIndex (computes the offset
  // from estimated/measured sizes) instead of scrollIntoView.
  useEffect(() => {
    if (!activeMatchMessageId) return;
    const idx = itemIndexByMessageId.get(activeMatchMessageId);
    if (idx === undefined) return;
    pinnedRef.current = false;
    virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
  }, [activeMatchMessageId, itemIndexByMessageId, pinnedRef, virtualizer]);

  const onCopy = (e: React.ClipboardEvent): void => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const container = containerRef.current;
    if (!container) return;
    const selectedIds = new Set<string>();
    // Note: virtualization unmounts off-screen rows, so a multi-bubble
    // selection that extends past the visible window will only see
    // the visible portion. Selecting across thousands of rows wasn't
    // a supported workflow before either; the common case (selecting
    // a few visible rows) keeps working as expected.
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

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      onCopy={onCopy}
      className="flex-1 overflow-auto bg-neutral-100 px-4 py-3"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (!item) return null;
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderItem(item, {
                editingId,
                setEditingId,
                replay,
                retry,
                conversation,
                effectiveLimitIndex,
                userNumbers,
                personas,
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RenderCtx {
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  replay: (id: string, content: string) => Promise<unknown>;
  retry: (m: Message) => Promise<unknown>;
  conversation: ReturnType<typeof useConversationsStore.getState>["conversations"][number] | undefined;
  effectiveLimitIndex: number | null;
  userNumbers: Map<number, number>;
  personas: readonly Persona[];
}

function renderItem(
  item: ReturnType<typeof groupIntoColumns>[number] | { kind: "row"; message: Message },
  ctx: RenderCtx,
): JSX.Element {
  const { editingId, setEditingId, replay, retry, conversation, effectiveLimitIndex, userNumbers, personas } =
    ctx;
  if (item.kind === "row") {
    const m = item.message;
    if (editingId === m.id && m.role === "user") {
      return (
        <EditReplayEditor
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
      message: m,
      personas,
      userNumber: userNumbers.get(m.index) ?? null,
      excluded: conversation ? isExcludedByLimit(m, conversation, effectiveLimitIndex) : false,
      onRetry: () => void retry(m),
      ...(m.role === "user" ? { onEdit: () => setEditingId(m.id) } : {}),
    };
    return <MessageBubble {...bubbleProps} />;
  }
  // Columns block (#16). One column per audience persona, in the
  // persona-panel sortOrder. Each column shows that persona's reply,
  // or a placeholder if absent.
  const sortedAudience = item.audience
    .map((id) => personas.find((p) => p.id === id))
    .filter((p): p is Persona => !!p)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => p.id);
  const cols = sortedAudience.length > 0 ? sortedAudience : item.audience;
  return (
    <div
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
}
