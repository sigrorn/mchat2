// Migration 4: apertus_product_id on personas — issue #15.
import { describe, it, expect } from "vitest";
import { MIGRATIONS } from "@/lib/persistence/migrations";

describe("MIGRATIONS[3] — apertus_product_id on personas", () => {
  it("adds an apertus_product_id TEXT column to personas", () => {
    const stmts = MIGRATIONS[3] ?? [];
    const joined = stmts.join("\n");
    expect(joined).toMatch(/ALTER TABLE personas\s+ADD COLUMN\s+apertus_product_id\s+TEXT/);
  });
});
