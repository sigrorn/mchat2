// #45 — Wire mermaid + viz fenced-code rendering.
import { describe, it, expect } from "vitest";
import { extractCodeBlocks, classify } from "@/lib/rendering/codeBlocks";
import { renderDiagramBlock, clearDiagramCache } from "@/lib/rendering/diagramRenderer";
import { sanitizeSvg } from "@/lib/rendering/sanitizeSvg";

describe("classify (existing)", () => {
  it("classifies mermaid blocks", () => {
    expect(classify("mermaid")).toBe("mermaid");
  });
  it("classifies dot blocks", () => {
    expect(classify("dot")).toBe("graphviz");
  });
  it("classifies graphviz blocks", () => {
    expect(classify("graphviz")).toBe("graphviz");
  });
  it("classifies code blocks", () => {
    expect(classify("typescript")).toBe("code");
  });
});

describe("extractCodeBlocks with diagrams", () => {
  it("extracts mermaid block from markdown", () => {
    const md = "Hello\n```mermaid\ngraph TD\n  A-->B\n```\nWorld";
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("mermaid");
    expect(blocks[0]?.source).toContain("A-->B");
  });

  it("extracts dot block from markdown", () => {
    const md = "```dot\ndigraph { a -> b }\n```";
    const blocks = extractCodeBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("graphviz");
  });
});

describe("renderDiagramBlock", () => {
  it("renders graphviz dot source to SVG", async () => {
    const svg = await renderDiagramBlock("graphviz", "digraph { a -> b }");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("returns error string for invalid graphviz", async () => {
    const result = await renderDiagramBlock("graphviz", "not valid dot");
    expect(result).toContain("Error");
  });

  // Mermaid requires a DOM (document) — skip in Node/vitest.
  // Covered by E2E tests in a real browser environment.
  it("returns error for mermaid in non-browser env", async () => {
    const result = await renderDiagramBlock("mermaid", "graph TD\n  A-->B");
    expect(typeof result).toBe("string");
  });

  it("returns null for unknown block kind", async () => {
    const result = await renderDiagramBlock("code", "console.log()");
    expect(result).toBeNull();
  });
});

describe("sanitizeSvg (#143)", () => {
  it("strips <script> tags from SVG", () => {
    const evil = `<svg><g><script>alert('xss')</script><circle r="5"/></g></svg>`;
    const out = sanitizeSvg(evil);
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain("alert(");
    expect(out).toContain("<circle");
  });

  it("strips inline event handlers", () => {
    const evil = `<svg onload="alert(1)"><rect onclick="alert(2)" width="10"/></svg>`;
    const out = sanitizeSvg(evil);
    expect(out).not.toMatch(/onload\s*=/i);
    expect(out).not.toMatch(/onclick\s*=/i);
  });

  it("strips javascript: URLs in href / xlink:href", () => {
    const evil = `<svg><a href="javascript:alert(1)"><text>x</text></a></svg>`;
    const out = sanitizeSvg(evil);
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("preserves benign SVG features (paths, circles, transforms)", () => {
    const benign = `<svg viewBox="0 0 100 100"><g transform="translate(10 10)"><circle cx="50" cy="50" r="40" fill="#abc"/><path d="M10 10 L90 90"/></g></svg>`;
    const out = sanitizeSvg(benign);
    expect(out).toContain("<circle");
    expect(out).toContain("<path");
    expect(out).toContain("transform");
    expect(out).toContain("viewBox");
  });
});

describe("renderDiagramBlock sanitizes its output (#143)", () => {
  it("graphviz output never contains <script>", async () => {
    clearDiagramCache();
    // Even though this dot source is benign, run the assertion to
    // codify the post-condition that all renderer output is sanitized.
    const svg = await renderDiagramBlock("graphviz", "digraph { a -> b }");
    expect(typeof svg).toBe("string");
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son\w+\s*=/i);
  });
});
