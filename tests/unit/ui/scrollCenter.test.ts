// Match-centered scroll offset (#239). Pure helper that computes
// the desired scrollTop to vertically center a match in the chat
// container, clamped at the container's scroll bounds.
import { describe, it, expect } from "vitest";
import { computeMatchScrollOffset } from "@/lib/ui/scrollCenter";

describe("computeMatchScrollOffset (#239)", () => {
  const HEIGHT = 600; // viewport
  const SCROLL_HEIGHT = 5000; // total content

  it("centers a match in the middle of the container when room exists", () => {
    // Match at content y=2000, height 40; viewport height 600.
    // Desired scrollTop = 2000 + 20 - 300 = 1720.
    const r = computeMatchScrollOffset({
      matchTop: 2000,
      matchHeight: 40,
      containerHeight: HEIGHT,
      scrollHeight: SCROLL_HEIGHT,
    });
    expect(r).toBe(1720);
  });

  it("clamps at 0 when the match is near the top of the chat", () => {
    const r = computeMatchScrollOffset({
      matchTop: 50,
      matchHeight: 20,
      containerHeight: HEIGHT,
      scrollHeight: SCROLL_HEIGHT,
    });
    expect(r).toBe(0);
  });

  it("clamps at scrollHeight - containerHeight when the match is near the bottom", () => {
    const r = computeMatchScrollOffset({
      matchTop: 4900,
      matchHeight: 20,
      containerHeight: HEIGHT,
      scrollHeight: SCROLL_HEIGHT,
    });
    expect(r).toBe(SCROLL_HEIGHT - HEIGHT);
  });

  it("returns 0 when content is shorter than the viewport", () => {
    const r = computeMatchScrollOffset({
      matchTop: 100,
      matchHeight: 20,
      containerHeight: HEIGHT,
      scrollHeight: 400,
    });
    expect(r).toBe(0);
  });

  it("centers a tall match (height larger than containerHeight) at its top", () => {
    // Tall match: viewport smaller than match. Desired places match
    // top above viewport top — clamped to 0 if near the start, but
    // for a mid-content tall match it should still attempt to center.
    const r = computeMatchScrollOffset({
      matchTop: 2000,
      matchHeight: 800, // taller than viewport
      containerHeight: HEIGHT,
      scrollHeight: SCROLL_HEIGHT,
    });
    // Math: 2000 + 400 - 300 = 2100. Still in bounds.
    expect(r).toBe(2100);
  });
});
