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

  // #112: markdown table format + generic forms with samples.
  it("renders as markdown tables", () => {
    const text = formatHelp();
    // Expect at least one table header separator row like "|---|---|".
    expect(text).toMatch(/\|\s*-{3,}\s*\|/);
  });

  it("uses generic form //autocompact Nk with a concrete sample", () => {
    const text = formatHelp();
    expect(text).toContain("//autocompact Nk");
    expect(text).toContain("//autocompact 12k");
    // The 'k' suffix requirement is called out.
    expect(text.toLowerCase()).toContain("k' suffix");
  });

  it("uses generic form //autocompact N% with description", () => {
    const text = formatHelp();
    expect(text).toContain("//autocompact N%");
  });

  it("shows preserve generic form with concrete sample", () => {
    const text = formatHelp();
    expect(text).toContain("preserve -N");
    // A worked example like 12k preserve -2
    expect(text).toMatch(/preserve\s+-\d+/);
  });

  it("uses generic form //compact -N with concrete sample", () => {
    const text = formatHelp();
    expect(text).toContain("//compact -N");
    expect(text).toContain("//compact -2");
  });
});
