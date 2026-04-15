// ------------------------------------------------------------------
// Component: Code block classifier
// Responsibility: Extract fenced code blocks and classify them so the
//                 UI and export layer can route mermaid / graphviz to
//                 their specialized renderers.
// Collaborators: rendering/markdown.ts, UI CodeBlock component.
// ------------------------------------------------------------------

export type BlockKind = "code" | "mermaid" | "graphviz";

export interface CodeBlock {
  kind: BlockKind;
  language: string;
  source: string;
}

const FENCE_RE = /^```(\w*)\s*\n([\s\S]*?)^```\s*$/gm;

export function extractCodeBlocks(src: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  for (const m of src.matchAll(FENCE_RE)) {
    const language = (m[1] ?? "").toLowerCase();
    const source = m[2] ?? "";
    out.push({ kind: classify(language), language, source });
  }
  return out;
}

export function classify(language: string): BlockKind {
  const l = language.toLowerCase();
  if (l === "mermaid") return "mermaid";
  if (l === "dot" || l === "graphviz") return "graphviz";
  return "code";
}
