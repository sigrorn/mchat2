// Tab-completion pure helpers (#238). Composer's Tab handler is a
// thin wrapper around these; most behaviour is unit-tested here.
import { describe, it, expect } from "vitest";
import {
  tokenAtCursor,
  candidatesFor,
  applyCompletion,
  type CompletionToken,
} from "@/lib/composer/complete";

function tok(input: string): CompletionToken {
  // Helper for cases where the cursor is at end-of-input.
  return tokenAtCursor(input, input.length);
}

describe("tokenAtCursor (#238)", () => {
  it("empty input → none", () => {
    expect(tok("").kind).toBe("none");
  });

  it("plain text → none", () => {
    expect(tok("hello world").kind).toBe("none");
  });

  it("//<cursor> → command with empty prefix", () => {
    const t = tokenAtCursor("//", 2);
    expect(t.kind).toBe("command");
    if (t.kind === "command") {
      expect(t.prefix).toBe("");
      expect(t.range).toEqual({ start: 0, end: 2 });
    }
  });

  it("//ed<cursor> → command with prefix 'ed'", () => {
    const t = tokenAtCursor("//ed", 4);
    expect(t.kind).toBe("command");
    if (t.kind === "command") {
      expect(t.prefix).toBe("ed");
      expect(t.range).toEqual({ start: 0, end: 4 });
    }
  });

  it("//edit <cursor> → none (whitespace ends the verb run)", () => {
    expect(tok("//edit ").kind).toBe("none");
  });

  it("//edit 3<cursor> → none (after argument)", () => {
    expect(tok("//edit 3").kind).toBe("none");
  });

  it("not at start: 'hi //help<cursor>' → none", () => {
    // // commands are only valid at the start of input.
    expect(tok("hi //help").kind).toBe("none");
  });

  it("leading whitespace before //ed is OK", () => {
    const t = tokenAtCursor("  //ed", 6);
    expect(t.kind).toBe("command");
    if (t.kind === "command") {
      expect(t.prefix).toBe("ed");
    }
  });

  it("@cl<cursor> → target with prefix 'cl'", () => {
    const t = tokenAtCursor("@cl", 3);
    expect(t.kind).toBe("target");
    if (t.kind === "target") {
      expect(t.prefix).toBe("cl");
      expect(t.range).toEqual({ start: 0, end: 3 });
    }
  });

  it("@all @cl<cursor> → target on second token (still in prefix run)", () => {
    const t = tokenAtCursor("@all @cl", 8);
    expect(t.kind).toBe("target");
    if (t.kind === "target") {
      expect(t.prefix).toBe("cl");
      expect(t.range).toEqual({ start: 5, end: 8 });
    }
  });

  it("@all hello @cl<cursor> → none (cursor past end of prefix run)", () => {
    expect(tok("@all hello @cl").kind).toBe("none");
  });

  it("+cl<cursor> → selection-add with prefix 'cl'", () => {
    const t = tokenAtCursor("+cl", 3);
    expect(t.kind).toBe("selection-add");
    if (t.kind === "selection-add") {
      expect(t.prefix).toBe("cl");
    }
  });

  it("-cl<cursor> → selection-remove with prefix 'cl'", () => {
    const t = tokenAtCursor("-cl", 3);
    expect(t.kind).toBe("selection-remove");
    if (t.kind === "selection-remove") {
      expect(t.prefix).toBe("cl");
    }
  });

  it("@a +b -c<cursor> → selection-remove with prefix 'c' (mixed prefix run)", () => {
    const t = tokenAtCursor("@a +b -c", 8);
    expect(t.kind).toBe("selection-remove");
    if (t.kind === "selection-remove") {
      expect(t.prefix).toBe("c");
      expect(t.range).toEqual({ start: 6, end: 8 });
    }
  });

  it("cursor at @<cursor> → target with empty prefix", () => {
    const t = tokenAtCursor("@", 1);
    expect(t.kind).toBe("target");
    if (t.kind === "target") expect(t.prefix).toBe("");
  });

  it("mid-token cursor: @cl<cursor>audio → target with prefix 'cl' but range covers whole token", () => {
    // Cursor between 'cl' and 'audio' — the prefix to filter by is
    // 'cl', but the replacement should cover the whole token.
    const t = tokenAtCursor("@claudio", 3);
    expect(t.kind).toBe("target");
    if (t.kind === "target") {
      expect(t.prefix).toBe("cl");
      expect(t.range).toEqual({ start: 0, end: 8 });
    }
  });
});

describe("candidatesFor (#238)", () => {
  const personas = [
    { id: "p1", nameSlug: "claudio" },
    { id: "p2", nameSlug: "geppetto" },
  ];
  const sources = { personas, flowAttached: false };

  it("target prefix '' returns persona slugs + @all + @convo + @others (≥2 personas)", () => {
    const t: CompletionToken = { kind: "target", prefix: "", range: { start: 0, end: 1 } };
    const c = candidatesFor(t, sources);
    expect(c).toEqual(expect.arrayContaining(["@claudio", "@geppetto", "@all", "@convo", "@others"]));
  });

  it("target prefix 'cl' filters to @claudio", () => {
    const t: CompletionToken = { kind: "target", prefix: "cl", range: { start: 0, end: 3 } };
    expect(candidatesFor(t, sources)).toEqual(["@claudio"]);
  });

  it("target with single persona omits @others", () => {
    const t: CompletionToken = { kind: "target", prefix: "", range: { start: 0, end: 1 } };
    const c = candidatesFor(t, { personas: [{ id: "p1", nameSlug: "alice" }], flowAttached: false });
    expect(c).toContain("@all");
    expect(c).toContain("@convo");
    expect(c).not.toContain("@others");
  });

  it("target candidates always include @convo regardless of flowAttached", () => {
    const t: CompletionToken = { kind: "target", prefix: "co", range: { start: 0, end: 3 } };
    expect(candidatesFor(t, { ...sources, flowAttached: false })).toEqual(["@convo"]);
    expect(candidatesFor(t, { ...sources, flowAttached: true })).toEqual(["@convo"]);
  });

  it("selection-add: persona slugs only, no @all/@convo/@others", () => {
    const t: CompletionToken = {
      kind: "selection-add",
      prefix: "",
      range: { start: 0, end: 1 },
    };
    const c = candidatesFor(t, sources);
    expect(c).toEqual(expect.arrayContaining(["+claudio", "+geppetto"]));
    expect(c).not.toContain("+all");
    expect(c).not.toContain("+convo");
    expect(c).not.toContain("+others");
  });

  it("selection-remove uses '-' prefix in candidates", () => {
    const t: CompletionToken = {
      kind: "selection-remove",
      prefix: "ge",
      range: { start: 0, end: 3 },
    };
    expect(candidatesFor(t, sources)).toEqual(["-geppetto"]);
  });

  it("command prefix 'ed' includes //edit", () => {
    const t: CompletionToken = { kind: "command", prefix: "ed", range: { start: 0, end: 4 } };
    const c = candidatesFor(t, sources);
    expect(c).toContain("//edit");
  });

  it("command empty prefix returns [] (handled specially by Composer)", () => {
    const t: CompletionToken = { kind: "command", prefix: "", range: { start: 0, end: 2 } };
    expect(candidatesFor(t, sources)).toEqual([]);
  });

  it("command no match returns []", () => {
    const t: CompletionToken = { kind: "command", prefix: "xyzqq", range: { start: 0, end: 7 } };
    expect(candidatesFor(t, sources)).toEqual([]);
  });

  it("none token returns []", () => {
    expect(candidatesFor({ kind: "none" }, sources)).toEqual([]);
  });
});

describe("applyCompletion (#238)", () => {
  it("inserts at start with trailing space", () => {
    const r = applyCompletion("@cl", { start: 0, end: 3 }, "@claudio", {
      appendSpaceOnComplete: true,
    });
    expect(r.text).toBe("@claudio ");
    expect(r.cursor).toBe("@claudio ".length);
  });

  it("inserts in middle", () => {
    const r = applyCompletion("@cl rest", { start: 0, end: 3 }, "@claudio", {
      appendSpaceOnComplete: true,
    });
    // No double space when next char is already whitespace.
    expect(r.text).toBe("@claudio rest");
    expect(r.cursor).toBe("@claudio".length);
  });

  it("does not append space when appendSpaceOnComplete=false", () => {
    const r = applyCompletion("//ed", { start: 0, end: 4 }, "//edit", {
      appendSpaceOnComplete: false,
    });
    expect(r.text).toBe("//edit");
    expect(r.cursor).toBe("//edit".length);
  });

  it("avoids double space when next char is whitespace", () => {
    const r = applyCompletion("@cl rest", { start: 0, end: 3 }, "@claudio", {
      appendSpaceOnComplete: true,
    });
    // Only one space total — the existing one. Cursor lands before
    // that existing space.
    expect(r.text).toBe("@claudio rest");
    expect(r.cursor).toBe("@claudio".length);
  });

  it("replaces mid-token entirely", () => {
    const r = applyCompletion("@claudio", { start: 0, end: 8 }, "@claudio", {
      appendSpaceOnComplete: true,
    });
    expect(r.text).toBe("@claudio ");
  });
});
