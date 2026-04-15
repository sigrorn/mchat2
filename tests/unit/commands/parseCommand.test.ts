// Command-parser tests — issue #8.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand", () => {
  it("non-command input → noop", () => {
    expect(parseCommand("hello world")).toEqual({ kind: "noop" });
    expect(parseCommand("@mock hi")).toEqual({ kind: "noop" });
    expect(parseCommand("/single-slash is not a command")).toEqual({ kind: "noop" });
  });

  it("//limit N → limit command with numeric payload", () => {
    expect(parseCommand("//limit 5")).toEqual({ kind: "limit", payload: { userNumber: 5 } });
    expect(parseCommand("  //limit 5  ")).toEqual({
      kind: "limit",
      payload: { userNumber: 5 },
    });
  });

  it("//limit NONE (case-insensitive) → clear", () => {
    expect(parseCommand("//limit NONE")).toEqual({
      kind: "limit",
      payload: { userNumber: null },
    });
    expect(parseCommand("//limit none")).toEqual({
      kind: "limit",
      payload: { userNumber: null },
    });
  });

  it("//limit ALL kept as a backwards-compat alias", () => {
    expect(parseCommand("//limit ALL")).toEqual({ kind: "limit", payload: { userNumber: null } });
    expect(parseCommand("//limit all")).toEqual({ kind: "limit", payload: { userNumber: null } });
  });

  it("help text mentions NONE", () => {
    const r = parseCommand("//limit");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/NONE/);
    }
  });

  it("//limit with no argument → error with help text", () => {
    const r = parseCommand("//limit");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/specify the user message number/i);
    }
  });

  it("//limit garbage → error naming the bad token", () => {
    const r = parseCommand("//limit foo");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("foo");
      expect(r.message).toMatch(/valid message number/i);
    }
  });

  it("//limit 0 and negative numbers rejected", () => {
    expect(parseCommand("//limit 0").kind).toBe("error");
    expect(parseCommand("//limit -3").kind).toBe("error");
  });
});
