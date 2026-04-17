// ------------------------------------------------------------------
// Component: Markdown export
// Responsibility: Render a conversation to a portable Markdown string
//                 that does NOT leak provider ids or model ids — only
//                 persona names as attribution (#56).
// Collaborators: conversations/exportToFile (orchestrator), Sidebar.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { redact } from "../security/redact";
import { userNumberByIndex } from "../conversations/userMessageNumber";
import { formatUserHeader } from "../conversations/userHeader";

export interface MarkdownExportInput {
  conversation: Conversation;
  messages: readonly Message[];
  personas: readonly Persona[];
  knownSecrets: readonly string[];
}

export function exportToMarkdown(input: MarkdownExportInput): string {
  const { conversation, messages, personas, knownSecrets } = input;
  const lines: string[] = [];
  const r = (s: string): string => redact({ text: s, knownSecrets: [...knownSecrets] });

  lines.push(`# ${r(conversation.title)}`);
  lines.push("");

  const userNumbers = userNumberByIndex(messages);
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  let lastRole: string | null = null;

  for (const m of messages) {
    if (m.role === "notice") continue;

    if (m.role === "user") {
      if (lastRole !== null) {
        lines.push("---");
        lines.push("");
      }
      const n = userNumbers.get(m.index) ?? null;
      const header = formatUserHeader(n, m.addressedTo, personas);
      const pin = m.pinned ? "📌 " : "";
      lines.push(`**${pin}${header}**`);
      lines.push(r(m.content));
      lines.push("");
    } else if (m.role === "assistant") {
      const persona = m.personaId ? personaById.get(m.personaId) : null;
      const name = persona?.name ?? "assistant";
      lines.push(`**${name}**`);
      if (m.errorMessage) {
        lines.push(`*error: ${r(m.errorMessage)}*`);
      } else {
        lines.push(r(m.content));
      }
      lines.push("");
    }

    lastRole = m.role;
  }

  return lines.join("\n");
}
