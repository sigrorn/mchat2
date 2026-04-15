// Migration 2: token-count columns on messages — issue #2.
import { describe, it, expect } from "vitest";
import { MIGRATIONS } from "@/lib/persistence/migrations";

describe("MIGRATIONS[1] — token counts on messages", () => {
  it("adds input_tokens, output_tokens, usage_estimated to messages", () => {
    const stmts = MIGRATIONS[1] ?? [];
    const joined = stmts.join("\n");
    expect(joined).toMatch(/ALTER TABLE messages\s+ADD COLUMN\s+input_tokens/);
    expect(joined).toMatch(/ALTER TABLE messages\s+ADD COLUMN\s+output_tokens/);
    expect(joined).toMatch(/ALTER TABLE messages\s+ADD COLUMN\s+usage_estimated/);
  });
});
