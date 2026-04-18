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

  it("//visibility full → maps to joined", () => {
    expect(parseCommand("//visibility full")).toEqual({
      kind: "visibility",
      payload: { mode: "joined" },
    });
  });

  it("rejects unknown modes", () => {
    const r = parseCommand("//visibility blah");
    expect(r.kind).toBe("error");
  });

  it("no argument → status query (#78)", () => {
    expect(parseCommand("//visibility").kind).toBe("visibilityStatus");
  });

  it("//visibility default → reset to persona defaults (#94)", () => {
    expect(parseCommand("//visibility default")).toEqual({ kind: "visibilityDefault" });
  });

  it("//visibility DEFAULT → case-insensitive (#94)", () => {
    expect(parseCommand("//visibility DEFAULT")).toEqual({ kind: "visibilityDefault" });
  });
});
