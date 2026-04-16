// //retry command parsing — issue #49.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //retry", () => {
  it("//retry with no argument is a valid retry", () => {
    expect(parseCommand("//retry")).toEqual({ kind: "retry" });
  });

  it("//retry rejects arguments (old mchat takes none)", () => {
    expect(parseCommand("//retry foo").kind).toBe("error");
    expect(parseCommand("//retry 3").kind).toBe("error");
  });

  it("tolerates trailing whitespace", () => {
    expect(parseCommand("//retry   ")).toEqual({ kind: "retry" });
  });
});
