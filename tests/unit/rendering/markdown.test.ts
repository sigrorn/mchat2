import { describe, it, expect } from "vitest";
import { renderMarkdownToHtml, escapeHtml } from "@/lib/rendering/markdown";
import { extractCodeBlocks, classify } from "@/lib/rendering/codeBlocks";

describe("renderMarkdownToHtml", () => {
  it("renders headings, paragraphs, bold, italic, code spans", () => {
    const html = renderMarkdownToHtml("# Title\n\nHello **world** with *emphasis* and `code`.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<code>code</code>");
  });

  it("preserves fenced code blocks with language class", () => {
    const html = renderMarkdownToHtml("```python\nprint('x')\n```");
    expect(html).toContain('<pre><code class="language-python">');
    expect(html).toContain("print(&#39;x&#39;)");
  });

  it("renders unordered and ordered lists", () => {
    const ul = renderMarkdownToHtml("- a\n- b");
    expect(ul).toBe("<ul><li>a</li><li>b</li></ul>");
    const ol = renderMarkdownToHtml("1. a\n2. b");
    expect(ol).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("renders links", () => {
    const html = renderMarkdownToHtml("See [docs](https://x.example).");
    expect(html).toContain('<a href="https://x.example">docs</a>');
  });

  it("escapes dangerous html", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
});

describe("extractCodeBlocks", () => {
  it("classifies mermaid and graphviz", () => {
    const src = "```mermaid\ngraph TD;A-->B\n```\n\n```dot\ndigraph{}\n```\n\n```js\n1\n```";
    const blocks = extractCodeBlocks(src);
    expect(blocks.map((b) => b.kind)).toEqual(["mermaid", "graphviz", "code"]);
    expect(blocks[1]?.language).toBe("dot");
  });

  it("classify() is case-insensitive", () => {
    expect(classify("MERMAID")).toBe("mermaid");
    expect(classify("Graphviz")).toBe("graphviz");
    expect(classify("")).toBe("code");
  });
});
