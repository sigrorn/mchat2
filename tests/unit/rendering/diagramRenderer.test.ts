// #45 — Wire mermaid + viz fenced-code rendering.
import { describe, it, expect } from "vitest";
import { extractCodeBlocks, classify } from "@/lib/rendering/codeBlocks";
import { renderDiagramBlock } from "@/lib/rendering/diagramRenderer";

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
    const md = '```dot\ndigraph { a -> b }\n```';
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

  it("renders mermaid source to SVG", async () => {
    const svg = await renderDiagramBlock("mermaid", "graph TD\n  A-->B");
    expect(svg).toContain("<svg");
  });

  it("returns null for unknown block kind", async () => {
    const result = await renderDiagramBlock("code", "console.log()");
    expect(result).toBeNull();
  });
});
