// Session-timestamped trace filename — issue #46.
import { describe, it, expect } from "vitest";
import { buildSessionTimestamp, buildTraceFilename } from "@/lib/tracing/traceFilename";

describe("buildSessionTimestamp", () => {
  it("produces YYYYMMDD-hhmmss in local 24hr time", () => {
    const d = new Date(2026, 3, 17, 14, 25, 9);
    expect(buildSessionTimestamp(d)).toBe("20260417-142509");
  });

  it("zero-pads single-digit fields", () => {
    const d = new Date(2026, 0, 3, 1, 2, 3);
    expect(buildSessionTimestamp(d)).toBe("20260103-010203");
  });
});

describe("buildTraceFilename", () => {
  it("concatenates session timestamp, conversation id, and persona slug", () => {
    expect(buildTraceFilename("20260417-142509", "c_abc", "claudio")).toBe(
      "20260417-142509-c_abc-claudio.txt",
    );
  });

  it("sanitizes persona slug characters that would break filenames", () => {
    // Persona slugs are already safe, but defensive: strip path separators,
    // colons, NULs. Whitespace collapsed to underscore.
    expect(buildTraceFilename("20260417-142509", "c_x", "Foo/Bar")).toBe(
      "20260417-142509-c_x-Foo_Bar.txt",
    );
    expect(buildTraceFilename("20260417-142509", "c_x", "a b:c")).toBe(
      "20260417-142509-c_x-a_b_c.txt",
    );
  });
});
