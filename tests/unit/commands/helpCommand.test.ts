// #80 — //help command.
import { describe, it, expect } from "vitest";
import { parseCommand } from "@/lib/commands/parseCommand";
import { formatHelp } from "@/lib/commands/help";

describe("parseCommand //help", () => {
  it("parses //help", () => {
    expect(parseCommand("//help")).toEqual({ kind: "help" });
  });
});

describe("formatHelp (#80)", () => {
  it("includes key commands", () => {
    const text = formatHelp();
    expect(text).toContain("//help");
    expect(text).toContain("//limit");
    expect(text).toContain("//pin");
    expect(text).toContain("//edit");
    expect(text).toContain("//visibility");
    expect(text).toContain("//order");
    expect(text).toContain("//stats");
    expect(text).toContain("//personas");
    expect(text).toContain("@all");
  });
});
