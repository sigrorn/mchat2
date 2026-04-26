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
// links [t](u), unordered lists (- ), ordered lists (1.), GFM tables,
// paragraphs. Intentionally small — anything richer (mermaid, math)
// goes through the fenced-code pipeline.

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
    // GFM table (header row + separator row + body rows)
    const tableHtml = tryTable(lines, i);
    if (tableHtml) {
      out.push(tableHtml.html);
      i = tableHtml.next;
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

type Align = "left" | "center" | "right" | null;

function parseTableCells(row: string): string[] {
  // Strip optional leading/trailing pipes and split.
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function parseAlignments(separator: string): Align[] | null {
  // Each separator cell must match :?---+:? — at least three dashes,
  // optional colons for alignment markers. Anything else makes this
  // not a real GFM table.
  const cells = parseTableCells(separator);
  if (cells.length === 0) return null;
  const out: Align[] = [];
  for (const c of cells) {
    if (!/^:?-{3,}:?$/.test(c)) return null;
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    out.push(left && right ? "center" : right ? "right" : left ? "left" : null);
  }
  return out;
}

function alignAttr(a: Align): string {
  return a ? ` style="text-align:${a}"` : "";
}

function tryTable(
  lines: readonly string[],
  start: number,
): { html: string; next: number } | null {
  const headerLine = lines[start] ?? "";
  const sepLine = lines[start + 1] ?? "";
  if (!headerLine.includes("|") || !sepLine.includes("|")) return null;
  const aligns = parseAlignments(sepLine);
  if (!aligns) return null;
  const headers = parseTableCells(headerLine);
  if (headers.length === 0) return null;
  // Pad/truncate alignments to header length so misaligned tables
  // still render rather than throwing the whole block back to
  // paragraph parsing.
  while (aligns.length < headers.length) aligns.push(null);

  const headHtml = headers
    .map((h, idx) => `<th${alignAttr(aligns[idx] ?? null)}>${inline(h)}</th>`)
    .join("");

  const bodyRows: string[] = [];
  let i = start + 2;
  while (i < lines.length) {
    const ln = lines[i] ?? "";
    if (ln.trim() === "" || !ln.includes("|")) break;
    const cells = parseTableCells(ln);
    const tds = cells
      .map((c, idx) => `<td${alignAttr(aligns[idx] ?? null)}>${inline(c)}</td>`)
      .join("");
    bodyRows.push(`<tr>${tds}</tr>`);
    i++;
  }

  const tbody =
    bodyRows.length > 0 ? `<tbody>${bodyRows.join("")}</tbody>` : "";
  return {
    html: `<table><thead><tr>${headHtml}</tr></thead>${tbody}</table>`,
    next: i,
  };
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
