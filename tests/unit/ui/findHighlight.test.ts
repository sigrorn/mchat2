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
});
