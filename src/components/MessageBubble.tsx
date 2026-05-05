// ------------------------------------------------------------------
// Component: MessageBubble
// Responsibility: Render a single message row — assistant/user/system/
//                 notice bubble with header, body, retry/edit affordances.
//                 Memoized so streaming a single row doesn't reconcile
//                 every other bubble in a long conversation (#128).
//                 Extracted from MessageList.tsx in #167 so list-level
//                 concerns (scroll-pin, column-grouping, find-scroll)
//                 stay separate from row presentation.
// Collaborators: MessageList (parent), DiagramBlock, scrollPin sibling,
//                rendering/messageBody, providers/derived.
// ------------------------------------------------------------------

import { memo, useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/lib/types";
import { readCachedMessages } from "@/hooks/cacheReaders";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import { formatProviderTag } from "@/lib/providers/headerTag";
import { renderMessageBody } from "@/lib/rendering/messageBody";
import { classify } from "@/lib/rendering/codeBlocks";
import { userNumberByIndex } from "@/lib/conversations/userMessageNumber";
import { formatUserHeader } from "@/lib/conversations/userHeader";
import { clearHighlights, highlightMatches } from "@/lib/ui/findHighlight";
import { formatBubbleTimestamp } from "@/lib/ui/formatBubbleTimestamp";
import { DiagramBlock } from "./DiagramBlock";
import {
  areBubblePropsEqual,
  type BubbleProps,
  type FindState,
} from "./messageBubbleMemo";
import { AttemptHistory } from "./AttemptHistory";
import { DangerButton } from "@/components/ui/Button";

// #239: post-render effect that overlays inline find highlights on
// the bubble's content. Runs after every render so streaming content
// (assistant rows growing token-by-token) keeps its highlights in
// sync with the find state.
function useFindHighlight(
  ref: React.RefObject<HTMLElement | null>,
  message: Message,
  findState: FindState | null | undefined,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    clearHighlights(el);
    if (!findState || findState.query === "") return;
    highlightMatches(el, findState.query, {
      caseSensitive: findState.caseSensitive,
      activeMatchIndex: findState.activeMatchIndex,
    });
    return () => {
      clearHighlights(el);
    };
    // message.content covers streaming updates; findState identity
    // covers query / case / active-match changes.
  }, [ref, message.content, message.id, findState]);
}

// #63: render #N patterns in notice text as clickable scroll-links.
// #211: scroll target lookup reads the current conversation's
// messages from the data-layer cache. Notices reference user
// messages within their own conversation; cross-conversation #N
// references aren't a real use case.
function NoticeContent({
  content,
  conversationId,
}: {
  content: string;
  conversationId: string;
}): JSX.Element {
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
              const msgs = readCachedMessages(conversationId);
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
    // react-markdown + remark-gfm gives tables, strikethrough, task
    // lists, etc. The custom renderer in lib/rendering/markdown.ts
    // stays in place for HTML export, where a React tree isn't
    // available.
    return (
      <div className={`markdown-body text-sm leading-relaxed ${tone}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...rest }) {
              const lang = className?.replace("language-", "") ?? "";
              const kind = classify(lang);
              if (kind !== "code") {
                const src = String(children).replace(/\n$/, "");
                return <DiagramBlock kind={kind} source={src} language={lang} />;
              }
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    );
  }
  return <div className={`whitespace-pre-wrap text-sm leading-relaxed ${tone}`}>{body.text}</div>;
}

function MessageBubbleImpl({
  message,
  personas,
  userNumber,
  excluded,
  onRetry,
  onEdit,
  onConfirm,
  findState,
}: BubbleProps): JSX.Element {
  // #239: bubble-root ref for inline find highlighting.
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  useFindHighlight(bubbleRef, message, findState ?? null);
  // Notice rows (#8): UI-only info/error from in-app commands. Visually
  // distinct, italicized, never reach the LLM.
  if (message.role === "notice") {
    // #112: notices that contain a markdown table (detected by a
    // "|---|" separator row) render through the markdown pipeline for
    // column alignment; simple single-line notices keep the plain-text
    // + #N-click path.
    const hasMarkdownTable = /^\s*\|[\s\-:|]+\|\s*$/m.test(message.content);
    return (
      <div
        ref={bubbleRef}
        role="note"
        data-message-id={message.id}
        className={`mb-3 flex items-start gap-2 rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm`}
      >
        <div
          className={`flex-1 ${hasMarkdownTable ? "" : "whitespace-pre-wrap italic"}`}
        >
          {hasMarkdownTable ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <NoticeContent content={message.content} conversationId={message.conversationId} />
          )}
        </div>
        {/* #229: confirm-and-hide checkbox. Click → notice disappears
            from the rendered list. The DB row stays so a future
            un-hide affordance can restore it (see docs/ideas.md). */}
        {onConfirm ? (
          <input
            type="checkbox"
            checked={false}
            onChange={onConfirm}
            title="Confirm and hide this notice"
            className="mt-0.5 cursor-pointer"
            aria-label="Confirm and hide notice"
          />
        ) : null}
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
    // #203: openai_compat alone is ambiguous — disclose which preset
    // (Infomaniak / OVHcloud / OpenRouter / IONOS / Custom) the
    // persona resolved through.
    if (message.provider) headerParts.push(formatProviderTag(message.provider, persona ?? null));
    if (message.model) headerParts.push(message.model);
  } else if (message.role === "user") {
    // [N] prefix is display-only — never written to message.content,
    // never sent to the LLM, never in exports.
    headerParts.push(
      formatUserHeader(
        userNumber,
        message.addressedTo,
        personas,
        message.pinTarget,
        message.flowDispatched ?? false,
      ),
    );
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
      ref={bubbleRef}
      data-excluded={excluded ? "true" : undefined}
      data-pinned={message.pinned ? "true" : undefined}
      data-message-id={message.id}
      data-msg-role={message.role}
      data-persona-id={message.personaId ?? undefined}
      className={`mb-3 rounded border-l-4 px-3 py-2 shadow-sm ${bubbleBg}`}
      style={{ borderLeftColor: color }}
    >
      {/* #265: items-start (was items-center) so the timestamp anchors to
          the top-right corner when the header wraps to a second line in
          cols mode. */}
      <div className="mb-1 flex items-start justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-600">
        {/* #265: render each headerPart as its own whitespace-nowrap flex
            item so the row can wrap at · boundaries when the column is
            too narrow for the full PERSONA · PROVIDER · MODEL line.
            Lines mode columns are wide enough that nothing wraps; cols
            mode with many personas wraps exactly when needed. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          {message.pinned ? (
            <span className="mr-1" aria-label="pinned">
              📌
            </span>
          ) : null}
          {headerParts.map((part, i) => (
            <span key={i} className="whitespace-nowrap">
              {i > 0 ? <span className="mr-2 text-neutral-400">·</span> : null}
              {part}
            </span>
          ))}
        </div>
        {/* #243: edit button (when present) sits left of the timestamp,
            timestamp anchors to the right edge of the row. tabular-nums
            keeps digit columns stable across rows. */}
        <div className="flex shrink-0 items-center gap-2">
          {onEdit ? (
            <button
              onClick={onEdit}
              className="rounded border border-neutral-300 px-1.5 py-0 text-[10px] font-normal normal-case text-neutral-500 hover:bg-neutral-100"
              title="Edit this message and regenerate replies"
            >
              edit
            </button>
          ) : null}
          <span
            className="font-normal normal-case tabular-nums text-neutral-500"
            title={new Date(message.createdAt).toISOString()}
          >
            {formatBubbleTimestamp(message.createdAt)}
          </span>
        </div>
      </div>
      {message.errorMessage ? (
        <div className="flex items-start justify-between gap-2">
          <div className="text-sm text-red-700">error: {message.errorMessage}</div>
          {onRetry && message.role === "assistant" ? (
            <DangerButton
              onClick={onRetry}
              size="xs"
              className="shrink-0"
              title="Retry this request with the same persona and context"
            >
              retry
            </DangerButton>
          ) : null}
        </div>
      ) : (
        renderBubbleBody(message, excluded)
      )}
      {/* #181: history expansion under assistant rows that have
          superseded sibling attempts on the same target_key. */}
      {message.role === "assistant" ? (
        <AttemptHistory conversationId={message.conversationId} messageId={message.id} />
      ) : null}
    </div>
  );
}

// #128: memoize so streaming a single row doesn't reconcile every
// other bubble in a long conversation. Comparator (messageBubbleMemo)
// ignores callback identity (closures churn on every parent render)
// and compares only props that affect the rendered output.
export const MessageBubble = memo(MessageBubbleImpl, areBubblePropsEqual);
