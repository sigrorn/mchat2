// ------------------------------------------------------------------
// Component: SVG sanitizer
// Responsibility: Strip script tags, event handlers, and javascript:
//                 URLs from SVG strings before they reach the DOM via
//                 dangerouslySetInnerHTML. Diagram sources come from
//                 LLM output, so the rendered SVG must be treated as
//                 untrusted (#143).
// Collaborators: rendering/diagramRenderer.ts (production caller),
//                components/DiagramBlock.tsx (eventual injection site).
// ------------------------------------------------------------------

import DOMPurify from "isomorphic-dompurify";

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
