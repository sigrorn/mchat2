// ------------------------------------------------------------------
// Component: HTML export
// Responsibility: Turn a conversation + its messages into a single
//                 self-contained HTML file, with secrets redacted.
// Collaborators: rendering/markdown.ts, security/redact.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { PROVIDER_COLORS, PROVIDER_DISPLAY_NAMES } from "../providers/derived";
import { renderMarkdownToHtml, escapeHtml } from "./markdown";
import { redact } from "../security/redact";

export interface HtmlExportInput {
  conversation: Conversation;
  messages: Message[];
  personas: Persona[];
  // Live key values pulled from keychain at export time. Never stored.
  knownSecrets: string[];
  // ISO timestamp shown in the export header. Supplied by the caller
  // so tests are deterministic.
  generatedAt: string;
}

export function exportToHtml(input: HtmlExportInput): string {
  const { conversation, messages, personas, knownSecrets, generatedAt } = input;
  const personaById = new Map(personas.map((p) => [p.id, p] as const));

  const body = messages
    .map((m) => {
      const safe = redact({ text: m.content, knownSecrets });
      const label = labelFor(m, personaById);
      const color = colorFor(m, personaById);
      const rendered = renderMarkdownToHtml(safe);
      return `<section class="msg ${m.role}" style="border-left-color:${escapeHtml(color)}">
        <header>${escapeHtml(label)}</header>
        <article>${rendered}</article>
      </section>`;
    })
    .join("\n");

  const title = escapeHtml(conversation.title);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:auto;padding:1.5rem;color:#111}
h1{font-size:1.5rem}
.meta{color:#666;font-size:.85rem;margin-bottom:1.5rem}
.msg{border-left:4px solid #aaa;padding:.75rem 1rem;margin-bottom:1rem;background:#fafafa;border-radius:4px}
.msg header{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:.25rem}
.msg.user{background:#f0f4ff}
pre{background:#f3f4f6;padding:.5rem .75rem;border-radius:4px;overflow-x:auto}
code{font-family:ui-monospace,SFMono-Regular,monospace}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">Exported ${escapeHtml(generatedAt)} · ${messages.length} messages</div>
${body}
</body>
</html>`;
}

function labelFor(m: Message, personaById: Map<string, Persona>): string {
  if (m.role === "user") return "User";
  if (m.role === "system") return "System";
  const persona = m.personaId ? personaById.get(m.personaId) : null;
  const name = persona?.name ?? (m.provider ? PROVIDER_DISPLAY_NAMES[m.provider] : "Assistant");
  return `${name}${m.model ? ` · ${m.model}` : ""}`;
}

function colorFor(m: Message, personaById: Map<string, Persona>): string {
  if (m.role !== "assistant") return "#6b7280";
  const persona = m.personaId ? personaById.get(m.personaId) : null;
  if (persona?.colorOverride) return persona.colorOverride;
  if (m.provider) return PROVIDER_COLORS[m.provider];
  return "#6b7280";
}
