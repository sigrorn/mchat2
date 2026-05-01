// ------------------------------------------------------------------
// Component: Inline find highlighting (#239)
// Responsibility: DOM walker that wraps every occurrence of a query
//                 in <mark data-find="match"> within a container.
//                 The active match (passed by index in document
//                 order) gets data-find="active" instead, so the
//                 user can spot which match prev/next is on without
//                 reading the X-of-Y counter.
// Collaborators: components/MessageBubble (post-render effect).
// Pure — operates on the supplied container's DOM only.
// ------------------------------------------------------------------

export interface HighlightOptions {
  caseSensitive: boolean;
  /** Index of the active match within this container (0-based, document
   *  order). Pass -1 for "no active match in this container." */
  activeMatchIndex: number;
}

const MARK_ATTR = "data-find";

/** Wrap every occurrence of `query` in the container's text nodes
 *  with a <mark> element. Returns the number of matches inserted. */
export function highlightMatches(
  container: HTMLElement,
  query: string,
  opts: HighlightOptions,
): number {
  if (query === "") return 0;
  const doc = container.ownerDocument;

  // Collect text nodes first; mutating during traversal would skip
  // siblings.
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip empty / whitespace-only nodes for tidier mark insertion.
      if (!node.nodeValue || node.nodeValue.length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      // Don't re-mark text inside an existing mark.
      const parent = node.parentElement;
      if (parent && parent.tagName === "MARK") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) textNodes.push(n as Text);
  }

  const needle = opts.caseSensitive ? query : query.toLowerCase();
  let matchOrdinal = 0;

  for (const node of textNodes) {
    const haystackRaw = node.nodeValue ?? "";
    const haystack = opts.caseSensitive ? haystackRaw : haystackRaw.toLowerCase();
    const positions: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i < haystack.length) {
      const idx = haystack.indexOf(needle, i);
      if (idx === -1) break;
      positions.push({ start: idx, end: idx + needle.length });
      i = idx + Math.max(1, needle.length);
    }
    if (positions.length === 0) continue;

    // Replace the text node with [text, mark, text, mark, ...].
    const parent = node.parentNode;
    if (!parent) continue;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    for (const p of positions) {
      if (p.start > cursor) {
        fragment.appendChild(doc.createTextNode(haystackRaw.slice(cursor, p.start)));
      }
      const mark = doc.createElement("mark");
      mark.setAttribute(
        MARK_ATTR,
        matchOrdinal === opts.activeMatchIndex ? "active" : "match",
      );
      mark.textContent = haystackRaw.slice(p.start, p.end);
      fragment.appendChild(mark);
      cursor = p.end;
      matchOrdinal++;
    }
    if (cursor < haystackRaw.length) {
      fragment.appendChild(doc.createTextNode(haystackRaw.slice(cursor)));
    }
    parent.replaceChild(fragment, node);
  }
  return matchOrdinal;
}

/** Strip every <mark data-find="..."> from the container, replacing
 *  each with its text content. Idempotent. */
export function clearHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll(`mark[${MARK_ATTR}]`);
  for (const mark of Array.from(marks)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  // Coalesce adjacent text nodes left over from the unwraps so
  // subsequent passes can scan them as a single haystack.
  container.normalize();
}
