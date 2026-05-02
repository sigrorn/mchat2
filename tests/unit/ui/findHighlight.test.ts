// @vitest-environment jsdom
// DOM highlight walker (#239). Walks rendered text nodes, wraps
// query matches in <mark>, optionally tags one as the active match.
// JSDOM-backed — no browser needed.
import { describe, it, expect, beforeEach } from "vitest";
import { highlightMatches, clearHighlights } from "@/lib/ui/findHighlight";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  root.innerHTML = "Hello World — hello again";
});

describe("highlightMatches (#239)", () => {
  it("wraps every case-insensitive match in <mark>", () => {
    const count = highlightMatches(root, "hello", {
      caseSensitive: false,
      activeMatchIndex: -1,
    });
    expect(count).toBe(2);
    const marks = root.querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe("Hello");
    expect(marks[1]?.textContent).toBe("hello");
    for (const m of marks) {
      expect(m.getAttribute("data-find")).toBe("match");
    }
  });

  it("respects case sensitivity", () => {
    const count = highlightMatches(root, "Hello", {
      caseSensitive: true,
      activeMatchIndex: -1,
    });
    expect(count).toBe(1);
    expect(root.querySelectorAll("mark")).toHaveLength(1);
  });

  it("tags the active match with data-find=\"active\"", () => {
    highlightMatches(root, "hello", {
      caseSensitive: false,
      activeMatchIndex: 1,
    });
    const marks = root.querySelectorAll("mark");
    expect(marks[0]?.getAttribute("data-find")).toBe("match");
    expect(marks[1]?.getAttribute("data-find")).toBe("active");
  });

  it("returns 0 and modifies nothing for empty query", () => {
    const before = root.innerHTML;
    const count = highlightMatches(root, "", {
      caseSensitive: false,
      activeMatchIndex: -1,
    });
    expect(count).toBe(0);
    expect(root.innerHTML).toBe(before);
  });

  it("returns 0 when query has no matches", () => {
    const count = highlightMatches(root, "xyzqq", {
      caseSensitive: false,
      activeMatchIndex: -1,
    });
    expect(count).toBe(0);
    expect(root.querySelectorAll("mark")).toHaveLength(0);
  });

  it("walks across nested elements and matches text spanning markdown structure", () => {
    root.innerHTML = "<p>Hello <strong>World</strong> hello</p>";
    const count = highlightMatches(root, "hello", {
      caseSensitive: false,
      activeMatchIndex: -1,
    });
    expect(count).toBe(2);
    expect(root.querySelectorAll("mark")).toHaveLength(2);
  });

  it("clearHighlights removes all marks but preserves text content", () => {
    highlightMatches(root, "hello", {
      caseSensitive: false,
      activeMatchIndex: -1,
    });
    expect(root.querySelectorAll("mark").length).toBeGreaterThan(0);
    const beforeText = root.textContent;
    clearHighlights(root);
    expect(root.querySelectorAll("mark")).toHaveLength(0);
    expect(root.textContent).toBe(beforeText);
  });

  it("re-applying highlight after clear works on the same root", () => {
    highlightMatches(root, "hello", {
      caseSensitive: false,
      activeMatchIndex: -1,
    });
    clearHighlights(root);
    const count = highlightMatches(root, "hello", {
      caseSensitive: false,
      activeMatchIndex: 0,
    });
    expect(count).toBe(2);
    expect(root.querySelectorAll("mark")[0]?.getAttribute("data-find")).toBe("active");
  });

  // #244: clearHighlights used to call container.normalize() unconditionally,
  // which merged adjacent text nodes that react-markdown was tracking as
  // separate. During streaming (the effect runs once per token batch),
  // that mutated the DOM under React's reconciler and dropped late tokens
  // for paragraph-shaped content. The fix short-circuits when there is
  // nothing to strip — leaving the DOM untouched.
  it("does not merge adjacent text nodes when there are no marks to strip (#244)", () => {
    const container = document.createElement("div");
    const a = document.createTextNode("Hello ");
    const b = document.createTextNode("World ");
    const c = document.createTextNode("again");
    container.appendChild(a);
    container.appendChild(b);
    container.appendChild(c);
    expect(container.childNodes).toHaveLength(3);

    clearHighlights(container);

    // Pre-fix: container.normalize() collapsed all three into one text
    // node. Post-fix: clearHighlights early-returns and the structure
    // react-markdown laid down survives.
    expect(container.childNodes).toHaveLength(3);
    expect(container.textContent).toBe("Hello World again");
  });
});
