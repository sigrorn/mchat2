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

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/lib/types";
import { useMessagesStore } from "@/stores/messagesStore";
import { PROVIDER_COLORS } from "@/lib/providers/derived";
import { renderMessageBody } from "@/lib/rendering/messageBody";
import { classify } from "@/lib/rendering/codeBlocks";
import { userNumberByIndex } from "@/lib/conversations/userMessageNumber";
import { formatUserHeader } from "@/lib/conversations/userHeader";
import { DiagramBlock } from "./DiagramBlock";
import { areBubblePropsEqual, type BubbleProps } from "./messageBubbleMemo";

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
}: BubbleProps): JSX.Element {
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
        role="note"
        data-message-id={message.id}
        className={`mb-3 rounded border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm ${
          hasMarkdownTable ? "" : "whitespace-pre-wrap italic"
        }`}
      >
        {hasMarkdownTable ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>
        ) : (
          <NoticeContent content={message.content} />
        )}
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
    headerParts.push(formatUserHeader(userNumber, message.addressedTo, personas, message.pinTarget));
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
      data-msg-role={message.role}
      data-persona-id={message.personaId ?? undefined}
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

// #128: memoize so streaming a single row doesn't reconcile every
// other bubble in a long conversation. Comparator (messageBubbleMemo)
// ignores callback identity (closures churn on every parent render)
// and compares only props that affect the rendered output.
export const MessageBubble = memo(MessageBubbleImpl, areBubblePropsEqual);
