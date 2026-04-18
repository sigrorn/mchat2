// //select command parsing — issue #95.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //select", () => {
  it("//select name1, name2 → select with names", () => {
    expect(parseCommand("//select alice, bob")).toEqual({
      kind: "select",
      payload: { names: ["alice", "bob"] },
    });
  });

  it("//select ALL → selectAll", () => {
    expect(parseCommand("//select ALL")).toEqual({ kind: "selectAll" });
  });

  it("//select all → case-insensitive", () => {
    expect(parseCommand("//select all")).toEqual({ kind: "selectAll" });
  });

  it("//select single name", () => {
    expect(parseCommand("//select alice")).toEqual({
      kind: "select",
      payload: { names: ["alice"] },
    });
  });

  it("//select with no argument → error", () => {
    expect(parseCommand("//select").kind).toBe("error");
  });

  it("trims whitespace around names", () => {
    expect(parseCommand("//select  alice ,  bob  ")).toEqual({
      kind: "select",
      payload: { names: ["alice", "bob"] },
    });
  });

  it("deduplicates names", () => {
    expect(parseCommand("//select alice, alice, bob")).toEqual({
      kind: "select",
      payload: { names: ["alice", "bob"] },
    });
  });
});
