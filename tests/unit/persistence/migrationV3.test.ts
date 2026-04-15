// Migration 3: audience column on messages — issue #4.
import { describe, it, expect } from "vitest";
import { MIGRATIONS } from "@/lib/persistence/migrations";

describe("MIGRATIONS[2] — audience on messages", () => {
  it("adds an audience TEXT column with JSON default", () => {
    const stmts = MIGRATIONS[2] ?? [];
    const joined = stmts.join("\n");
    expect(joined).toMatch(/ALTER TABLE messages\s+ADD COLUMN\s+audience\s+TEXT/);
    expect(joined).toMatch(/DEFAULT\s+'\[]'/);
  });
});
