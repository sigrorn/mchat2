// //pop command parsing — issue #48, #91.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //pop", () => {
  it("//pop with no argument → pop last", () => {
    expect(parseCommand("//pop")).toEqual({ kind: "pop", payload: { userNumber: null } });
  });

  it("//pop N → rewind to user message N (#91)", () => {
    expect(parseCommand("//pop 3")).toEqual({ kind: "pop", payload: { userNumber: 3 } });
  });

  it("rejects non-numeric argument", () => {
    expect(parseCommand("//pop foo").kind).toBe("error");
  });

  it("tolerates trailing whitespace", () => {
    expect(parseCommand("//pop   ")).toEqual({ kind: "pop", payload: { userNumber: null } });
  });
});
