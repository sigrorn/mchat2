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
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders GFM tables (#163)", () => {
    const md = `| col1 | col2 |
|------|------|
| a    | b    |
| c    | d    |`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>col1</th>");
    expect(html).toContain("<th>col2</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>a</td>");
    expect(html).toContain("<td>b</td>");
    expect(html).toContain("<td>c</td>");
    expect(html).toContain("<td>d</td>");
    expect(html).not.toContain("|col1|");
  });

  it("table cells inherit alignment from the separator row (#163)", () => {
    const md = `| L | C | R |
|:---|:---:|---:|
| a | b | c |`;
    const html = renderMarkdownToHtml(md);
    // Header alignment applies to <th> cells.
    expect(html).toMatch(/<th[^>]*style="text-align:left"[^>]*>L<\/th>/);
    expect(html).toMatch(/<th[^>]*style="text-align:center"[^>]*>C<\/th>/);
    expect(html).toMatch(/<th[^>]*style="text-align:right"[^>]*>R<\/th>/);
    // Body alignment applies to <td> cells too.
    expect(html).toMatch(/<td[^>]*style="text-align:left"[^>]*>a<\/td>/);
    expect(html).toMatch(/<td[^>]*style="text-align:center"[^>]*>b<\/td>/);
    expect(html).toMatch(/<td[^>]*style="text-align:right"[^>]*>c<\/td>/);
  });

  it("table rendering ends at a blank line (#163)", () => {
    const md = `| h |
|---|
| x |

After the table.`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("</table>");
    expect(html).toContain("<p>After the table.</p>");
  });

  it("inline markdown still works inside table cells (#163)", () => {
    const md = `| a | b |
|---|---|
| **bold** | \`code\` |`;
    const html = renderMarkdownToHtml(md);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("a row that looks like a table header but has no separator stays a paragraph (#163)", () => {
    const md = `| not | a | table |
just text after.`;
    const html = renderMarkdownToHtml(md);
    expect(html).not.toContain("<table>");
    // Pipes survive in the paragraph (escaped HTML).
    expect(html).toContain("|");
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
