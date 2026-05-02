// formatBubbleTimestamp — #243.
//
// Pure formatter: ms epoch → "YYYY-MM-DD HH:MM:SS" in *local* time,
// 24-hour. Tests construct Dates from local-time components so the
// expected output is the same regardless of the test runner's TZ.
import { describe, it, expect } from "vitest";
import { formatBubbleTimestamp } from "@/lib/ui/formatBubbleTimestamp";

describe("formatBubbleTimestamp", () => {
  it("formats a known local-time date with zero-padded fields", () => {
    // 2026-05-02 09:03:07 local time.
    const d = new Date(2026, 4, 2, 9, 3, 7);
    expect(formatBubbleTimestamp(d.getTime())).toBe("2026-05-02 09:03:07");
  });

  it("zero-pads month and day at boundaries", () => {
    const d = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatBubbleTimestamp(d.getTime())).toBe("2026-01-01 00:00:00");
  });

  it("uses 24-hour clock for afternoon hours", () => {
    const d = new Date(2026, 4, 2, 23, 59, 59);
    expect(formatBubbleTimestamp(d.getTime())).toBe("2026-05-02 23:59:59");
  });

  it("zero-pads hours/minutes/seconds when single-digit", () => {
    const d = new Date(2026, 4, 2, 1, 2, 3);
    expect(formatBubbleTimestamp(d.getTime())).toBe("2026-05-02 01:02:03");
  });
});
