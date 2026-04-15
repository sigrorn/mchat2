// ------------------------------------------------------------------
// Component: Live message body renderer
// Responsibility: Decide whether a message bubble should render its
//                 content as plain text or as markdown-derived HTML.
//                 Pure so MessageList stays trivial and the routing
//                 rule is unit-testable without React.
// Collaborators: rendering/markdown.ts, components/MessageList.tsx.
// ------------------------------------------------------------------

import type { Message } from "../types";
import { renderMarkdownToHtml } from "./markdown";

export type RenderedBody =
  | { kind: "html"; html: string }
  | { kind: "text"; text: string };

export function renderMessageBody(message: Message): RenderedBody {
  // Only assistant content is markdown. User text is intentionally
  // verbatim — typed asterisks/backticks should survive. Notices and
  // error rows are app-authored single lines.
  if (message.role === "assistant" && !message.errorMessage) {
    return { kind: "html", html: renderMarkdownToHtml(message.content) };
  }
  return { kind: "text", text: message.content };
}
