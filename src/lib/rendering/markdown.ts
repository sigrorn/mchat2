// ------------------------------------------------------------------
// Component: Markdown renderer (export)
// Responsibility: Convert markdown to self-contained HTML for the
//                 export pipeline. Kept separate from the React
//                 component tree so HTML export does not need a
//                 browser-side render pass.
// Collaborators: rendering/htmlExport.ts, rendering/codeBlocks.ts.
// ------------------------------------------------------------------

// Minimal markdown subset: headings (#..######), fenced code blocks
// (``` with optional language), inline code (`), bold (**), italic (*),
// links [t](u), unordered lists (- ), ordered lists (1.), paragraphs.
// This is intentionally small — anything richer (mermaid, math) goes
// through the fenced-code pipeline and is rendered by a specialized
// block renderer, not by extending the markdown grammar here.

export function renderMarkdownToHtml(src: string): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    // Fenced code
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      if (i < lines.length) i++;
      const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]?.length ?? 1;
      out.push(`<h${level}>${inline(h[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }
    // List (gather a run)
    if (/^(\s*)([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(\s*)([-*]|\d+\.)\s+/.test(lines[i] ?? "")) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i] ?? "");
        items.push(`<li>${inline(m?.[3] ?? "")}</li>`);
        i++;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }
    // Paragraph (gather until blank or block start)
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^#{1,6}\s+/.test(lines[i] ?? "") &&
      !/^```/.test(lines[i] ?? "") &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i] ?? "")
    ) {
      paragraph.push(lines[i] ?? "");
      i++;
    }
    out.push(`<p>${inline(paragraph.join(" "))}</p>`);
  }
  return out.join("\n");
}

function inline(s: string): string {
  // Escape first, then decode back just the span markers we own.
  let r = escapeHtml(s);
  r = r.replace(/`([^`]+)`/g, (_m, g1: string) => `<code>${g1}</code>`);
  r = r.replace(/\*\*([^*]+)\*\*/g, (_m, g1: string) => `<strong>${g1}</strong>`);
  r = r.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre: string, g1: string) => `${pre}<em>${g1}</em>`);
  r = r.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, t: string, u: string) => `<a href="${escapeAttr(u)}">${t}</a>`,
  );
  return r;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
