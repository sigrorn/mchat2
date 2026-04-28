// ------------------------------------------------------------------
// Component: ChatView
// Responsibility: Compose MessageList + Composer for the selected
//                 conversation. Loads per-conversation state on mount.
//                 Hosts the header's prev/next user-message arrows
//                 and Ctrl+Shift+Up/Down shortcuts (#137).
// ------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useUiStore } from "@/stores/uiStore";
import { useRepoQuery } from "@/lib/data/useRepoQuery";
import * as messagesRepo from "@/lib/persistence/messages";
import * as personasRepo from "@/lib/persistence/personas";
import * as conversationsRepo from "@/lib/persistence/conversations";
import { findMatches } from "@/lib/ui/findMatches";
import {
  computeScrollTarget,
  computeUserMsgNav,
  navTooltipText,
  selectNavMessageIds,
  type UserMsgPos,
} from "@/lib/ui/userMessageNav";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { PersonaPanel } from "./PersonaPanel";
import { MatrixPanel } from "./MatrixPanel";
import { FindBar } from "./FindBar";
import type { Conversation, Message, Persona } from "@/lib/types";

const EMPTY: readonly Message[] = Object.freeze([]);
const EMPTY_PERSONAS: readonly Persona[] = Object.freeze([]);

interface NavMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  userMessages: UserMsgPos[];
  paddingTop: number;
}

const EMPTY_METRICS: NavMetrics = {
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
  userMessages: [],
  paddingTop: 0,
};

// Offset of `child` within `container`'s scroll origin, robust to
// offsetParent (the scroll container often isn't positioned, so
// child.offsetTop alone reports a misleading value).
function relativeTop(child: HTMLElement, container: HTMLElement): number {
  return (
    child.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
  );
}

export function ChatView(): JSX.Element {
  const currentId = useConversationsStore((s) => s.currentId);
  const conversationsQuery = useRepoQuery<Conversation[]>(
    ["conversations"],
    () => conversationsRepo.listConversations(),
  );
  const conversation = (conversationsQuery.data ?? []).find((c) => c.id === currentId);
  const loadMessages = useMessagesStore((s) => s.load);
  const loadPersonas = usePersonasStore((s) => s.load);

  useEffect(() => {
    if (!currentId) return;
    void loadMessages(currentId);
    void loadPersonas(currentId);
  }, [currentId, loadMessages, loadPersonas]);

  // #53/#211: compute matches for the find bar from the active
  // conversation. Hook order requires these before any early return;
  // message list is empty when the conversation isn't loaded yet.
  const messagesQuery = useRepoQuery<Message[]>(
    conversation ? ["messages", conversation.id] : ["messages", "__none__"],
    () =>
      conversation ? messagesRepo.listMessages(conversation.id) : Promise.resolve([]),
  );
  const messages = messagesQuery.data ?? EMPTY;
  const find = useUiStore((s) => s.find);
  const matches = useMemo(
    () => (find.open ? findMatches(messages, find.query, find.caseSensitive) : []),
    [find.open, find.query, find.caseSensitive, messages],
  );
  const activeMatch = matches[find.activeIndex] ?? null;

  // #137: ref to the message-list scroll container — used to read
  // current scroll metrics and to scroll programmatically when the
  // arrow buttons or Ctrl+Shift+Up/Down fire.
  const scrollRef = useRef<HTMLDivElement>(null);
  // #137: shared with MessageList so we can mark the container
  // unpinned before a programmatic scroll. Without this, when the
  // user is exactly at the bottom (pinnedRef=true) and presses ▲,
  // MessageList's tail-pin layout effect yanks back to the bottom
  // before the smooth scroll can pull us out of the 8px pin
  // threshold.
  const pinnedRef = useRef(true);
  const [metrics, setMetrics] = useState<NavMetrics>(EMPTY_METRICS);

  // #137: which persona the arrows scope to. null = navigate user
  // commands (default). Independent of the persona-send selection
  // (the sidebar checkboxes) — selecting a persona for navigation
  // does not change which personas the next message is addressed to.
  const personasQuery = useRepoQuery<Persona[]>(
    conversation ? ["personas", conversation.id] : ["personas", "__none__"],
    () =>
      conversation ? personasRepo.listPersonas(conversation.id) : Promise.resolve([]),
  );
  const personas = personasQuery.data ?? EMPTY_PERSONAS;
  const [navPersonaId, setNavPersonaId] = useState<string | null>(null);
  // Reset when the conversation changes — a persona id is only valid
  // within its own conversation.
  useEffect(() => {
    setNavPersonaId(null);
  }, [currentId]);
  // Drop the selection if the persona was deleted.
  useEffect(() => {
    if (navPersonaId && !personas.some((p) => p.id === navPersonaId)) {
      setNavPersonaId(null);
    }
  }, [personas, navPersonaId]);
  const navPersonaName = navPersonaId
    ? (personas.find((p) => p.id === navPersonaId)?.name ?? null)
    : null;

  const navIds = useMemo(
    () => selectNavMessageIds(messages, navPersonaId),
    [messages, navPersonaId],
  );

  const refreshMetrics = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) {
      setMetrics(EMPTY_METRICS);
      return;
    }
    const positions: UserMsgPos[] = [];
    for (const id of navIds) {
      const b = el.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
      if (b) positions.push({ id, offsetTop: relativeTop(b, el) });
    }
    const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
    setMetrics({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      userMessages: positions,
      paddingTop,
    });
  }, [navIds]);

  // Recompute when the message list changes size or content. ResizeObserver
  // covers font-zoom and window resize; the messages dependency covers
  // bubble adds/removes and streaming-induced height changes.
  useEffect(() => {
    refreshMetrics();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => refreshMetrics());
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [refreshMetrics, messages]);

  const nav = useMemo(
    () =>
      computeUserMsgNav({
        scrollTop: metrics.scrollTop,
        scrollHeight: metrics.scrollHeight,
        clientHeight: metrics.clientHeight,
        userMessages: metrics.userMessages,
        viewportTopOffset: metrics.paddingTop,
      }),
    [metrics],
  );

  const scrollToUser = useCallback((id: string): void => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!target) return;
    // Mark unpinned BEFORE the smooth scroll so MessageList's tail-pin
    // layout effect doesn't yank us back to the bottom on the first
    // re-render. Without this, ▲ from the very bottom is a no-op when
    // the target is on-screen (smooth scroll never escapes the pin's
    // 8px threshold before being yanked).
    pinnedRef.current = false;
    const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
    el.scrollTo({ top: computeScrollTarget(relativeTop(target, el), paddingTop), behavior: "smooth" });
  }, []);

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const goPrev = useCallback((): void => {
    if (nav.prevId) scrollToUser(nav.prevId);
  }, [nav.prevId, scrollToUser]);

  const goNext = useCallback((): void => {
    if (nav.nextId) scrollToUser(nav.nextId);
    else if (nav.nextIsBottom) scrollToBottom();
  }, [nav.nextId, nav.nextIsBottom, scrollToUser, scrollToBottom]);

  // Ctrl+Shift+Up/Down — handled here (not App.tsx) so the shortcut is
  // tied to the conversation that owns the scroll container.
  useEffect(() => {
    if (!conversation) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conversation, goPrev, goNext]);

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
        <header className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2 text-sm font-medium">
          <div className="min-w-0 truncate">{conversation.title}</div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={goPrev}
              disabled={nav.upDisabled}
              title={navTooltipText("prev", navPersonaName)}
              aria-label={navTooltipText("prev", navPersonaName)}
              className="rounded border border-current px-1.5 py-0.5 text-xs hover:bg-neutral-500/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={nav.downDisabled}
              title={navTooltipText("next", navPersonaName)}
              aria-label={navTooltipText("next", navPersonaName)}
              className="rounded border border-current px-1.5 py-0.5 text-xs hover:bg-neutral-500/20 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ▼
            </button>
          </div>
        </header>
        <FindBar matchCount={matches.length} />
        <MessageList
          conversationId={conversation.id}
          activeMatchMessageId={activeMatch?.messageId ?? null}
          scrollContainerRef={scrollRef}
          pinnedRef={pinnedRef}
          onScroll={refreshMetrics}
        />
        <div className="flex border-t border-neutral-200">
          <Composer conversation={conversation} />
          <MatrixPanel conversation={conversation} />
        </div>
      </div>
      <PersonaPanel
        conversation={conversation}
        navPersonaId={navPersonaId}
        onSelectNavPersona={(id) => setNavPersonaId(id === navPersonaId ? null : id)}
      />
    </div>
  );
}
