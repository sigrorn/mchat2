// //pop command parsing — issue #48.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //pop", () => {
  it("//pop with no argument is a valid pop", () => {
    expect(parseCommand("//pop")).toEqual({ kind: "pop" });
  });

  it("//pop rejects arguments (none allowed)", () => {
    expect(parseCommand("//pop 3").kind).toBe("error");
    expect(parseCommand("//pop foo").kind).toBe("error");
  });

  it("tolerates trailing whitespace", () => {
    expect(parseCommand("//pop   ")).toEqual({ kind: "pop" });
  });
});
