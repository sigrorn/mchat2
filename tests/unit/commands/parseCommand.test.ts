// Command-parser tests — issue #8.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand", () => {
  it("non-command input → noop", () => {
    expect(parseCommand("hello world")).toEqual({ kind: "noop" });
    expect(parseCommand("@mock hi")).toEqual({ kind: "noop" });
    expect(parseCommand("/single-slash is not a command")).toEqual({ kind: "noop" });
  });

  // #240: //limit and //limitsize were removed in favor of //compact /
  // //autocompact (compaction summarizes; limit just hid). Both verbs
  // now fall through the registry as unknown → noop, so a stray
  // "//limit 5" types into the chat as plain text instead of executing.
  it("//limit and //limitsize → noop after #240 removal", () => {
    expect(parseCommand("//limit 5")).toEqual({ kind: "noop" });
    expect(parseCommand("//limit NONE")).toEqual({ kind: "noop" });
    expect(parseCommand("//limit")).toEqual({ kind: "noop" });
    expect(parseCommand("//limitsize")).toEqual({ kind: "noop" });
    expect(parseCommand("//limitsize 12").kind).toBe("noop");
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

  // #224 — //fork: branch a conversation from a specific user message.
  it("//fork (no arg) → fork with userNumber null", () => {
    expect(parseCommand("//fork")).toEqual({
      kind: "fork",
      payload: { userNumber: null },
    });
    expect(parseCommand("  //fork  ")).toEqual({
      kind: "fork",
      payload: { userNumber: null },
    });
  });

  it("//fork N → fork with userNumber N", () => {
    expect(parseCommand("//fork 5")).toEqual({
      kind: "fork",
      payload: { userNumber: 5 },
    });
    expect(parseCommand("//fork 1")).toEqual({
      kind: "fork",
      payload: { userNumber: 1 },
    });
  });

  it("//fork 0 → error (user messages are 1-indexed)", () => {
    const r = parseCommand("//fork 0");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toMatch(/1-indexed|must be at least 1/i);
    }
  });

  it("//fork -1 → error", () => {
    expect(parseCommand("//fork -1").kind).toBe("error");
  });

  it("//fork foo → error naming the bad token", () => {
    const r = parseCommand("//fork foo");
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("foo");
    }
  });
});
