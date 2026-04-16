// Per-persona trace formatter — issue #40.
import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  formatTraceLines,
  buildOutboundRows,
  buildInboundRows,
} from "@/lib/tracing/traceWriter";

describe("formatTimestamp", () => {
  it("renders HHMMSS.mmm in local time", () => {
    // 2026-04-16 12:30:45.678 local — strftime('%H%M%S.') + ms
    const d = new Date(2026, 3, 16, 12, 30, 45, 678);
    expect(formatTimestamp(d)).toBe("123045.678");
  });

  it("zero-pads single-digit fields", () => {
    const d = new Date(2026, 3, 16, 1, 2, 3, 9);
    expect(formatTimestamp(d)).toBe("010203.009");
  });
});

describe("formatTraceLines", () => {
  const ts = new Date(2026, 3, 16, 12, 30, 45, 678);

  it("emits one row per content line, sharing direction + timestamp prefix", () => {
    const rows = formatTraceLines(ts, "I", ["line one", "line two"]);
    expect(rows).toEqual(["123045.678 I line one", "123045.678 I line two"]);
  });

  it("splits multi-line content across rows", () => {
    const rows = formatTraceLines(ts, "I", ["alpha\nbeta\ngamma"]);
    expect(rows).toEqual([
      "123045.678 I alpha",
      "123045.678 I beta",
      "123045.678 I gamma",
    ]);
  });

  it("preserves blank lines (empty lines emit blank rows)", () => {
    const rows = formatTraceLines(ts, "O", ["foo\n\nbar"]);
    expect(rows).toEqual(["123045.678 O foo", "123045.678 O ", "123045.678 O bar"]);
  });
});

describe("buildOutboundRows", () => {
  const ts = new Date(2026, 3, 16, 12, 30, 45, 678);

  it("brackets each role and emits one row per message line", () => {
    const rows = buildOutboundRows(ts, "You are alice.", [
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello" },
    ]);
    expect(rows).toEqual([
      "123045.678 O [system] You are alice.",
      "123045.678 O [user] hi there",
      "123045.678 O [assistant] hello",
    ]);
  });

  it("omits the system row when systemPrompt is null", () => {
    const rows = buildOutboundRows(ts, null, [{ role: "user", content: "hi" }]);
    expect(rows).toEqual(["123045.678 O [user] hi"]);
  });

  it("multiline message content splits with the bracketed role on the first row only", () => {
    // Old mchat puts the full '[role] content' string through splitlines, so
    // continuation lines do NOT carry the role bracket — they're raw text.
    const rows = buildOutboundRows(ts, null, [{ role: "user", content: "line1\nline2" }]);
    expect(rows).toEqual([
      "123045.678 O [user] line1",
      "123045.678 O line2",
    ]);
  });
});

describe("buildInboundRows", () => {
  const ts = new Date(2026, 3, 16, 12, 30, 45, 678);

  it("emits one row per line of the accumulated reply", () => {
    expect(buildInboundRows(ts, "first\nsecond")).toEqual([
      "123045.678 I first",
      "123045.678 I second",
    ]);
  });

  it("returns no rows for empty content (silent runs leave the file alone)", () => {
    expect(buildInboundRows(ts, "")).toEqual([]);
  });
});
