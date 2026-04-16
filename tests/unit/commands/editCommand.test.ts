// //edit command parsing — issue #47.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //edit", () => {
  it("//edit with no argument targets the last user message (userNumber: null)", () => {
    const r = parseCommand("//edit");
    expect(r).toEqual({ kind: "edit", payload: { userNumber: null } });
  });

  it("//edit N targets absolute user message N", () => {
    expect(parseCommand("//edit 3")).toEqual({ kind: "edit", payload: { userNumber: 3 } });
  });

  it("//edit -N targets Nth-last user message (negative kept as-is)", () => {
    expect(parseCommand("//edit -1")).toEqual({ kind: "edit", payload: { userNumber: -1 } });
    expect(parseCommand("//edit -2")).toEqual({ kind: "edit", payload: { userNumber: -2 } });
  });

  it("rejects non-integer arguments", () => {
    const r = parseCommand("//edit foo");
    expect(r.kind).toBe("error");
  });

  it("rejects zero (no 0th user message)", () => {
    const r = parseCommand("//edit 0");
    expect(r.kind).toBe("error");
  });

  it("accepts extra whitespace around the number", () => {
    expect(parseCommand("//edit   2  ")).toEqual({ kind: "edit", payload: { userNumber: 2 } });
  });
});
