// ------------------------------------------------------------------
// Component: HTML export
// Responsibility: Turn a conversation + its messages into a single
//                 self-contained HTML file, with secrets redacted.
// Collaborators: rendering/markdown.ts, security/redact.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";
import { PROVIDER_COLORS, PROVIDER_DISPLAY_NAMES, formatHostingTag } from "../providers/derived";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { renderMarkdownToHtml, escapeHtml } from "./markdown";
import { redact } from "../security/redact";
import { formatUserHeader } from "../conversations/userHeader";

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
      const label = labelFor(m, personaById, personas);
      const color = colorFor(m, personaById);
      const rendered = renderMarkdownToHtml(safe);
      return `<section class="msg ${m.role}" style="border-left-color:${escapeHtml(color)}">
        <header>${escapeHtml(label)}</header>
        <article>${rendered}</article>
      </section>`;
    })
    .join("\n");

  const personasSection = renderPersonasSection(personas, conversation, knownSecrets);

  const title = escapeHtml(conversation.title);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:auto;padding:1.5rem;color:#111}
h1{font-size:1.5rem}
h2{font-size:1.1rem;margin-top:1.5rem}
.meta{color:#666;font-size:.85rem;margin-bottom:1.5rem}
.msg{border-left:4px solid #aaa;padding:.75rem 1rem;margin-bottom:1rem;background:#fafafa;border-radius:4px}
.msg header{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:.25rem}
.msg.user{background:#f0f4ff}
.personas{margin-bottom:1.5rem}
.persona{border-left:4px solid #aaa;padding:.5rem 1rem;margin-bottom:.75rem;background:#fafafa;border-radius:4px}
.persona header{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#555;margin-bottom:.25rem}
.persona .system-prompt{margin:0;font-size:.85rem;white-space:pre-wrap}
.persona .system-prompt-empty{margin:0;font-size:.85rem;color:#888;font-style:italic}
.persona .source{font-size:.7rem;color:#888;font-weight:normal;text-transform:none;letter-spacing:0;margin-left:.5rem}
pre{background:#f3f4f6;padding:.5rem .75rem;border-radius:4px;overflow-x:auto}
code{font-family:ui-monospace,SFMono-Regular,monospace}
table{border-collapse:collapse;margin:.5rem 0;font-size:.95em}
th,td{border:1px solid #d1d5db;padding:.35rem .6rem}
th{background:#f3f4f6;font-weight:600;text-align:left}
</style>
</head>
<body>
<h1>${title}</h1>
<div class="meta">Exported ${escapeHtml(generatedAt)} · ${messages.length} messages</div>
${personasSection}${body}
</body>
</html>`;
}

function labelFor(
  m: Message,
  personaById: Map<string, Persona>,
  personas: readonly Persona[],
): string {
  if (m.role === "user") {
    return formatUserHeader(null, m.addressedTo, personas, m.pinTarget);
  }
  if (m.role === "system") return "System";
  const persona = m.personaId ? personaById.get(m.personaId) : null;
  const name = persona?.name ?? (m.provider ? PROVIDER_DISPLAY_NAMES[m.provider] : "Assistant");
  return `${name}${m.model ? ` · ${m.model}` : ""}`;
}

function renderPersonasSection(
  personas: readonly Persona[],
  conversation: Conversation,
  knownSecrets: readonly string[],
): string {
  if (personas.length === 0) return "";
  const items = personas
    .map((p) => {
      // #141: prefix the provider name with the hosting-country tag
      // (e.g. "[CH] Apertus") so the export keeps the data-sovereignty
      // signal that the in-app UI shows.
      const providerName = PROVIDER_DISPLAY_NAMES[p.provider] ?? p.provider;
      const tag = formatHostingTag(PROVIDER_REGISTRY[p.provider]?.hostingCountry ?? null);
      const provider = tag ? `${tag} ${providerName}` : providerName;
      const headerParts = [p.name, provider];
      if (p.modelOverride) headerParts.push(p.modelOverride);
      const head = headerParts.map(escapeHtml).join(" · ");
      const override = p.systemPromptOverride;
      const effective = override ?? conversation.systemPrompt;
      const source =
        override !== null
          ? "(persona override)"
          : conversation.systemPrompt
            ? "(conversation-level)"
            : null;
      const sourceTag = source ? `<span class="source">${escapeHtml(source)}</span>` : "";
      const promptHtml = effective
        ? `<pre class="system-prompt">${escapeHtml(redact({ text: effective, knownSecrets: [...knownSecrets] }))}</pre>`
        : `<p class="system-prompt-empty">no system prompt</p>`;
      return `<div class="persona"><header>${head}${sourceTag}</header>${promptHtml}</div>`;
    })
    .join("\n");
  return `<section class="personas"><h2>Personas</h2>\n${items}\n</section>\n`;
}

function colorFor(m: Message, personaById: Map<string, Persona>): string {
  if (m.role !== "assistant") return "#6b7280";
  const persona = m.personaId ? personaById.get(m.personaId) : null;
  if (persona?.colorOverride) return persona.colorOverride;
  if (m.provider) return PROVIDER_COLORS[m.provider];
  return "#6b7280";
}
