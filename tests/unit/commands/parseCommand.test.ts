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

  it("//limit 0 is a valid sentinel meaning 'hide all' (#51)", () => {
    expect(parseCommand("//limit 0")).toEqual({ kind: "limit", payload: { userNumber: 0 } });
  });

  it("//limit -N still rejected (negative numbers have no meaning)", () => {
    expect(parseCommand("//limit -3").kind).toBe("error");
  });

  // Pin family — issue #11.
  it("//pin <targets> <body> → pin command with the raw remainder", () => {
    const r = parseCommand("//pin @claudio @gepetto do that");
    expect(r).toEqual({ kind: "pin", payload: { rest: "@claudio @gepetto do that" } });
  });

  it("//pin without arguments → error", () => {
    expect(parseCommand("//pin").kind).toBe("error");
    expect(parseCommand("//pin   ").kind).toBe("error");
  });

  it("//pins (no arg) → list", () => {
    expect(parseCommand("//pins")).toEqual({ kind: "pins", payload: { persona: null } });
  });

  it("//pins <name> → list filtered to persona", () => {
    expect(parseCommand("//pins claudio")).toEqual({
      kind: "pins",
      payload: { persona: "claudio" },
    });
  });

  it("//unpin N → unpin with numeric payload", () => {
    expect(parseCommand("//unpin 5")).toEqual({ kind: "unpin", payload: { userNumber: 5 } });
  });

  it("//unpin without args → error", () => {
    expect(parseCommand("//unpin").kind).toBe("error");
  });

  it("//unpin garbage → error", () => {
    expect(parseCommand("//unpin foo").kind).toBe("error");
    expect(parseCommand("//unpin 0").kind).toBe("error");
    expect(parseCommand("//unpin -1").kind).toBe("error");
  });

  // Display mode — issue #16.
  it("//lines (no arg) → displayMode lines", () => {
    expect(parseCommand("//lines")).toEqual({
      kind: "displayMode",
      payload: { mode: "lines" },
    });
  });

  it("//cols (no arg) → displayMode cols", () => {
    expect(parseCommand("//cols")).toEqual({
      kind: "displayMode",
      payload: { mode: "cols" },
    });
  });

  it("//lines with extra args → error", () => {
    expect(parseCommand("//lines foo").kind).toBe("error");
    expect(parseCommand("//cols 5").kind).toBe("error");
  });

  // Compact with preservation count — issue #110.
  it("//compact (no arg) → compact everything", () => {
    expect(parseCommand("//compact")).toEqual({ kind: "compact", payload: { preserve: 0 } });
  });

  it("//compact -N → compact preserving last N user messages", () => {
    expect(parseCommand("//compact -2")).toEqual({ kind: "compact", payload: { preserve: 2 } });
    expect(parseCommand("//compact -1")).toEqual({ kind: "compact", payload: { preserve: 1 } });
  });

  it("//compact with positive N → error (syntax hint)", () => {
    expect(parseCommand("//compact 2").kind).toBe("error");
  });

  it("//compact with invalid arg → error", () => {
    expect(parseCommand("//compact foo").kind).toBe("error");
    expect(parseCommand("//compact -foo").kind).toBe("error");
  });

  // Autocompact with preserve — issue #111.
  it("//autocompact Nk → kTokens mode", () => {
    expect(parseCommand("//autocompact 48k")).toEqual({
      kind: "autocompact",
      payload: { mode: "kTokens", value: 48 },
    });
  });

  it("//autocompact Nk preserve -M → kTokens with preservation", () => {
    expect(parseCommand("//autocompact 48k preserve -2")).toEqual({
      kind: "autocompact",
      payload: { mode: "kTokens", value: 48, preserve: 2 },
    });
  });

  it("//autocompact N% preserve -M → percent with preservation", () => {
    expect(parseCommand("//autocompact 75% preserve -3")).toEqual({
      kind: "autocompact",
      payload: { mode: "percent", value: 75, preserve: 3 },
    });
  });

  it("//autocompact N (no k suffix, no %) → error", () => {
    expect(parseCommand("//autocompact 48").kind).toBe("error");
  });

  it("//autocompact off preserve → error (cannot combine)", () => {
    expect(parseCommand("//autocompact off preserve -2").kind).toBe("error");
  });

  it("//autocompact preserve variants with bad values → error", () => {
    expect(parseCommand("//autocompact 48k preserve").kind).toBe("error");
    expect(parseCommand("//autocompact 48k preserve foo").kind).toBe("error");
    expect(parseCommand("//autocompact 48k preserve 2").kind).toBe("error");
  });

  // Autocompact — issue #105 (syntax updated in #111 to Nk).
  it("//autocompact Nk → kTokens mode", () => {
    expect(parseCommand("//autocompact 48k")).toEqual({
      kind: "autocompact",
      payload: { mode: "kTokens", value: 48 },
    });
    expect(parseCommand("  //autocompact 100k  ")).toEqual({
      kind: "autocompact",
      payload: { mode: "kTokens", value: 100 },
    });
  });

  it("//autocompact N% → percent mode", () => {
    expect(parseCommand("//autocompact 75%")).toEqual({
      kind: "autocompact",
      payload: { mode: "percent", value: 75 },
    });
    expect(parseCommand("//autocompact 80%")).toEqual({
      kind: "autocompact",
      payload: { mode: "percent", value: 80 },
    });
  });

  it("//autocompact off → off mode", () => {
    expect(parseCommand("//autocompact off")).toEqual({
      kind: "autocompact",
      payload: { mode: "off" },
    });
    expect(parseCommand("//autocompact OFF")).toEqual({
      kind: "autocompact",
      payload: { mode: "off" },
    });
  });

  it("//autocompact with no args → error", () => {
    expect(parseCommand("//autocompact").kind).toBe("error");
  });

  it("//autocompact with invalid arg → error", () => {
    expect(parseCommand("//autocompact foo").kind).toBe("error");
    expect(parseCommand("//autocompact %").kind).toBe("error");
    expect(parseCommand("//autocompact 0k").kind).toBe("error");
    expect(parseCommand("//autocompact 0%").kind).toBe("error");
    expect(parseCommand("//autocompact 101%").kind).toBe("error");
  });

  it("//log → default limit 50, no clear", () => {
    expect(parseCommand("//log")).toEqual({
      kind: "log",
      payload: { limit: 50, clear: false },
    });
  });

  it("//log N → limit N", () => {
    expect(parseCommand("//log 20")).toEqual({
      kind: "log",
      payload: { limit: 20, clear: false },
    });
  });

  it("//log clear → clear flag", () => {
    expect(parseCommand("//log clear")).toEqual({
      kind: "log",
      payload: { limit: 50, clear: true },
    });
  });

  it("//log with invalid arg → error", () => {
    expect(parseCommand("//log foo").kind).toBe("error");
    expect(parseCommand("//log 0").kind).toBe("error");
    expect(parseCommand("//log -1").kind).toBe("error");
  });
});
