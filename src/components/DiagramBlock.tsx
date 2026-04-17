// ------------------------------------------------------------------
// Component: DiagramBlock
// Responsibility: Render a mermaid or graphviz code block as an inline
//                 SVG with a toggle to show the raw source.
// Collaborators: rendering/diagramRenderer.ts, MessageList.tsx.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { BlockKind } from "@/lib/rendering/codeBlocks";
import { renderDiagramBlock } from "@/lib/rendering/diagramRenderer";

interface Props {
  kind: BlockKind;
  source: string;
  language: string;
}

export function DiagramBlock({ kind, source, language }: Props): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void renderDiagramBlock(kind, source).then((result) => {
      if (cancelled) return;
      if (result === null || result.startsWith("Error")) {
        setError(result);
      } else {
        setSvg(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [kind, source]);

  return (
    <div className="my-2">
      {svg && !showSource ? (
        <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : error ? (
        <pre className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</pre>
      ) : !svg ? (
        <div className="text-xs text-neutral-400">Rendering {language}...</div>
      ) : null}
      {showSource && (
        <pre className="mt-1 rounded bg-neutral-100 p-2 text-xs">
          <code>{source}</code>
        </pre>
      )}
      {svg && (
        <button
          onClick={() => setShowSource((x) => !x)}
          className="mt-1 text-xs text-neutral-500 hover:text-neutral-900"
        >
          {showSource ? "hide source" : "show source"}
        </button>
      )}
    </div>
  );
}
