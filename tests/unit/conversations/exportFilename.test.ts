// Default filename helper for HTML export — issue #17.
import { describe, it, expect } from "vitest";
import { defaultExportFilename } from "@/lib/conversations/exportToFile";

describe("defaultExportFilename", () => {
  it("slugifies the title and appends a colon-free timestamp", () => {
    const out = defaultExportFilename("My Chat!", "2026-04-15T22:30:45.000Z");
    expect(out).toMatch(/^my-chat-2026-04-15T22-30-45\.html$/);
  });

  it("falls back to 'chat' when the title is empty after slugify", () => {
    const out = defaultExportFilename("???", "2026-04-15T22:30:45.000Z");
    expect(out).toMatch(/^chat-2026-04-15T22-30-45\.html$/);
  });

  it("strips multiple punctuation runs into a single dash", () => {
    const out = defaultExportFilename("a / b — c", "2026-01-01T00:00:00.000Z");
    expect(out).toMatch(/^a-b-c-/);
  });
});
