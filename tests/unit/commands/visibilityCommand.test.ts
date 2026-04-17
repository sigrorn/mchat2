// //visibility command parsing — issue #52.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //visibility", () => {
  it("//visibility separated → valid", () => {
    expect(parseCommand("//visibility separated")).toEqual({
      kind: "visibility",
      payload: { mode: "separated" },
    });
  });

  it("//visibility joined → valid", () => {
    expect(parseCommand("//visibility joined")).toEqual({
      kind: "visibility",
      payload: { mode: "joined" },
    });
  });

  it("case-insensitive", () => {
    expect(parseCommand("//visibility SEPARATED")).toEqual({
      kind: "visibility",
      payload: { mode: "separated" },
    });
  });

  it("rejects unknown modes", () => {
    const r = parseCommand("//visibility full");
    expect(r.kind).toBe("error");
  });

  it("rejects missing argument", () => {
    expect(parseCommand("//visibility").kind).toBe("error");
  });
});
