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

// #320: plain dompurify (not isomorphic-dompurify) — this code only ever
// runs in the Tauri webview, where window/DOM exist, so the isomorphic
// SSR wrapper served no purpose. Unit tests that exercise this set the
// jsdom environment so DOMPurify has a window to bind to.
import DOMPurify from "dompurify";

export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
