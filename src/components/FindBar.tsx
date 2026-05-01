// ------------------------------------------------------------------
// Component: FindBar
// Responsibility: Inline search overlay for the current conversation
//                 (#53). Opens on Ctrl+F via uiStore.openFind; Escape
//                 closes; Enter / Shift+Enter step forward / backward
//                 through matches.
// Collaborators: uiStore (state), MessageList (scrolls to active match).
// ------------------------------------------------------------------

import { useEffect, useRef, type RefObject } from "react";
import { useUiStore } from "@/stores/uiStore";

export function FindBar({
  matchCount,
  scrollContainerRef,
}: {
  matchCount: number;
  // #239: forwarded from ChatView so PgUp / PgDn / Home / End / arrows
  // typed in the find input scroll the chat container instead of
  // dying at the input field.
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
}): JSX.Element | null {
  const find = useUiStore((s) => s.find);
  const setQuery = useUiStore((s) => s.setFindQuery);
  const setCase = useUiStore((s) => s.setFindCaseSensitive);
  const setActive = useUiStore((s) => s.setFindActiveIndex);
  const close = useUiStore((s) => s.closeFind);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (find.open) ref.current?.focus();
  }, [find.open]);

  if (!find.open) return null;

  // #239: forward scroll keys to the chat container so the user can
  // browse context above / below the current match without leaving
  // the find input.
  const scrollChat = (delta: number, behavior: "smooth" | "auto" = "smooth"): void => {
    const el = scrollContainerRef?.current;
    if (!el) return;
    el.scrollBy({ top: delta, behavior });
  };
  const scrollChatTo = (top: number): void => {
    const el = scrollContainerRef?.current;
    if (!el) return;
    el.scrollTo({ top, behavior: "smooth" });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (matchCount === 0) return;
      const delta = e.shiftKey ? -1 : 1;
      const next = (find.activeIndex + delta + matchCount) % matchCount;
      setActive(next);
      return;
    }
    // #239: scroll-key forwarding. The find input is single-line, so
    // PgUp / PgDn / Home / End / vertical arrows don't have any
    // useful in-field semantics — repurpose them to scroll the chat.
    const el = scrollContainerRef?.current;
    if (!el) return;
    const page = el.clientHeight - 24; // small overlap to keep context
    if (e.key === "PageDown") {
      e.preventDefault();
      scrollChat(page);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      scrollChat(-page);
    } else if (e.key === "Home" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      scrollChatTo(0);
    } else if (e.key === "End" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      scrollChatTo(el.scrollHeight);
    } else if (e.key === "ArrowDown" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      scrollChat(40);
    } else if (e.key === "ArrowUp" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      scrollChat(-40);
    }
  };

  const label =
    matchCount === 0 ? (find.query ? "0 matches" : "") : `${find.activeIndex + 1} of ${matchCount}`;

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
      <input
        ref={ref}
        value={find.query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Find in chat"
        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
      />
      <span className="tabular-nums text-neutral-500">{label}</span>
      <button
        onClick={() => setCase(!find.caseSensitive)}
        className={`rounded border px-1.5 py-0.5 ${find.caseSensitive ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-500 hover:bg-neutral-100"}`}
        title="Match case"
      >
        Aa
      </button>
      <button
        onClick={() =>
          matchCount > 0 && setActive((find.activeIndex - 1 + matchCount) % matchCount)
        }
        disabled={matchCount === 0}
        className="rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
        title="Previous match (Shift+Enter)"
      >
        ↑
      </button>
      <button
        onClick={() => matchCount > 0 && setActive((find.activeIndex + 1) % matchCount)}
        disabled={matchCount === 0}
        className="rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
        title="Next match (Enter)"
      >
        ↓
      </button>
      <button
        onClick={close}
        className="rounded border border-neutral-300 px-1.5 py-0.5 text-neutral-500 hover:bg-neutral-100"
        title="Close (Escape)"
      >
        ×
      </button>
    </div>
  );
}
