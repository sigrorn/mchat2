// //limitsize command parsing — issue #64.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";

describe("parseCommand //limitsize", () => {
  it("//limitsize with no argument → auto (null payload)", () => {
    expect(parseCommand("//limitsize")).toEqual({
      kind: "limitsize",
      payload: { kTokens: null },
    });
  });

  it("//limitsize 30 → 30k tokens", () => {
    expect(parseCommand("//limitsize 30")).toEqual({
      kind: "limitsize",
      payload: { kTokens: 30 },
    });
  });

  it("//limitsize 0 → clear (same as //limit NONE for this field)", () => {
    expect(parseCommand("//limitsize 0")).toEqual({
      kind: "limitsize",
      payload: { kTokens: 0 },
    });
  });

  it("rejects non-integer argument", () => {
    expect(parseCommand("//limitsize foo").kind).toBe("error");
  });

  it("rejects negative numbers", () => {
    expect(parseCommand("//limitsize -5").kind).toBe("error");
  });
});
