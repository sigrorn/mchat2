// ------------------------------------------------------------------
// Component: Diagram renderer
// Responsibility: Render mermaid and graphviz fenced code blocks to
//                 SVG strings. Lazy-loads the heavy diagram libraries
//                 on first use and caches rendered SVGs by source hash
//                 so streaming tokens don't re-render every frame.
// Collaborators: rendering/codeBlocks.ts, components/DiagramBlock.tsx.
// ------------------------------------------------------------------

import type { BlockKind } from "./codeBlocks";

const svgCache = new Map<string, string>();

export async function renderDiagramBlock(kind: BlockKind, source: string): Promise<string | null> {
  if (kind === "code") return null;

  const cacheKey = `${kind}:${source}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  try {
    const svg = kind === "mermaid" ? await renderMermaid(source) : await renderGraphviz(source);
    svgCache.set(cacheKey, svg);
    return svg;
  } catch (e) {
    const msg = `Error rendering ${kind}: ${e instanceof Error ? e.message : String(e)}`;
    svgCache.set(cacheKey, msg);
    return msg;
  }
}

async function renderMermaid(source: string): Promise<string> {
  const mermaid = await import("mermaid");
  mermaid.default.initialize({ startOnLoad: false, theme: "neutral" });
  const { svg } = await mermaid.default.render(`mermaid-${Date.now()}`, source);
  return svg;
}

async function renderGraphviz(source: string): Promise<string> {
  const { instance } = await import("@viz-js/viz");
  const viz = await instance();
  return viz.renderString(source, { format: "svg", engine: "dot" });
}

export function clearDiagramCache(): void {
  svgCache.clear();
}
