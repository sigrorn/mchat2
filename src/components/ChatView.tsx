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

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  paddingTop: number;
}

const EMPTY_SCROLL_METRICS: ScrollMetrics = {
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 0,
  paddingTop: 0,
};

const EMPTY_POSITIONS: readonly UserMsgPos[] = Object.freeze([]);

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

  const markSeen = useConversationsStore((s) => s.markSeen);
  useEffect(() => {
    if (!currentId) return;
    void loadMessages(currentId);
    void loadPersonas(currentId);
    // #250: stamp last_seen_at on activation so the sidebar's unread
    // dot clears for this conversation. lastMessageAt may already be
    // ahead (a stream landed while the user was elsewhere); the stamp
    // brings them level so hasUnread returns false on the next render.
    void markSeen(currentId, Date.now());
    const departing = currentId;
    // #241 Phase C dropped the runs_after column, so the lazy-on-open
    // auto-migration that lived here through Phase 0 no longer has a
    // data source — legacy edges only enter via import paths now,
    // which run the migration themselves with a transient map.
    return () => {
      // #250: re-stamp on departure. Tokens that streamed in while
      // the user was viewing this conversation moved lastMessageAt
      // forward in the cache without touching lastSeenAt; without
      // this catch-up, switching away would falsely show a dot for
      // content the user already saw being typed out. Tokens that
      // arrive *after* this re-stamp will correctly trip the dot.
      void markSeen(departing, Date.now());
    };
  }, [currentId, loadMessages, loadPersonas, markSeen]);

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
  // #239: index of the active match WITHIN its message (0-based,
  // document order). MessageList passes this through to the bubble's
  // useFindHighlight effect so the i-th <mark> in that bubble gets
  // the strong-active class.
  const activeMatchIndexInMessage = useMemo(() => {
    if (!activeMatch) return -1;
    let count = 0;
    for (let i = 0; i < find.activeIndex; i++) {
      if (matches[i]?.messageId === activeMatch.messageId) count++;
    }
    return count;
  }, [activeMatch, matches, find.activeIndex]);

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

  // #245: scroll metrics still come from the live container (scroll
  // events, ResizeObserver). User-message positions now come from
  // MessageList — sourced from the virtualizer's measurementsCache so
  // the arrows know about every nav target, not just the few currently
  // mounted by react-virtual's overscan window.
  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>(EMPTY_SCROLL_METRICS);
  const [navPositions, setNavPositions] = useState<readonly UserMsgPos[]>(EMPTY_POSITIONS);

  const refreshScrollMetrics = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) {
      setScrollMetrics(EMPTY_SCROLL_METRICS);
      return;
    }
    const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
    setScrollMetrics({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      paddingTop,
    });
  }, []);

  // Recompute scroll metrics when the message list changes size.
  // ResizeObserver covers font-zoom and window resize; the messages
  // dependency covers bubble adds/removes and streaming-induced height
  // changes.
  useEffect(() => {
    refreshScrollMetrics();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => refreshScrollMetrics());
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [refreshScrollMetrics, messages]);

  const onNavPositionsChange = useCallback((positions: UserMsgPos[]): void => {
    setNavPositions(positions);
  }, []);

  const nav = useMemo(
    () =>
      computeUserMsgNav({
        scrollTop: scrollMetrics.scrollTop,
        scrollHeight: scrollMetrics.scrollHeight,
        clientHeight: scrollMetrics.clientHeight,
        userMessages: navPositions,
        viewportTopOffset: scrollMetrics.paddingTop,
      }),
    [scrollMetrics, navPositions],
  );

  const scrollToUser = useCallback((id: string): void => {
    const el = scrollRef.current;
    if (!el) return;
    // #245: read offset from navPositions (sourced from the
    // virtualizer's measurementsCache) so prev/next can land on
    // bubbles that aren't currently mounted by react-virtual. The
    // earlier `el.querySelector` path silently no-op'd whenever the
    // target was outside the overscan window. Fall back to the DOM
    // when navPositions doesn't carry the id (e.g. nav-persona
    // messages that aren't in the current navIds set).
    let offsetTop = navPositions.find((p) => p.id === id)?.offsetTop;
    if (offsetTop === undefined) {
      const target = el.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
      if (!target) return;
      offsetTop = relativeTop(target, el);
    }
    // Mark unpinned BEFORE the smooth scroll so MessageList's tail-pin
    // layout effect doesn't yank us back to the bottom on the first
    // re-render. Without this, ▲ from the very bottom is a no-op when
    // the target is on-screen (smooth scroll never escapes the pin's
    // 8px threshold before being yanked).
    pinnedRef.current = false;
    const paddingTop = parseFloat(getComputedStyle(el).paddingTop) || 0;
    el.scrollTo({ top: computeScrollTarget(offsetTop, paddingTop), behavior: "smooth" });
  }, [navPositions]);

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
        <FindBar matchCount={matches.length} scrollContainerRef={scrollRef} />
        <MessageList
          conversationId={conversation.id}
          activeMatchMessageId={activeMatch?.messageId ?? null}
          activeMatchIndexInMessage={activeMatchIndexInMessage}
          findQuery={find.open ? find.query : ""}
          findCaseSensitive={find.caseSensitive}
          scrollContainerRef={scrollRef}
          pinnedRef={pinnedRef}
          onScroll={refreshScrollMetrics}
          navIds={navIds}
          onNavPositionsChange={onNavPositionsChange}
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
