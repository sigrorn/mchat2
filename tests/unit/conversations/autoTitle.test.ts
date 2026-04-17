// Auto-title post-processing — issue #54.
import { describe, it, expect } from "vitest";
import { cleanTitle } from "@/lib/conversations/autoTitle";

describe("cleanTitle", () => {
  it("strips leading/trailing whitespace", () => {
    expect(cleanTitle("  hello world  ")).toBe("hello world");
  });

  it("strips trailing period", () => {
    expect(cleanTitle("My chat.")).toBe("My chat");
  });

  it("strips matched surrounding double quotes", () => {
    expect(cleanTitle('"Math homework"')).toBe("Math homework");
  });

  it("strips matched surrounding single quotes", () => {
    expect(cleanTitle("'Math homework'")).toBe("Math homework");
  });

  it("truncates to 25 characters", () => {
    const long = "This is a very long title that exceeds the limit";
    expect(cleanTitle(long).length).toBeLessThanOrEqual(25);
  });

  it("returns empty string for whitespace-only input", () => {
    expect(cleanTitle("   ")).toBe("");
  });

  it("handles combined: quoted + trailing period + whitespace", () => {
    expect(cleanTitle('  "Hello world."  ')).toBe("Hello world");
  });

  it("does not strip mismatched quotes", () => {
    expect(cleanTitle('"Hello world')).toBe('"Hello world');
  });
});
