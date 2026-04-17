// Migration v5 — visibility_matrix column on conversations (#52).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { MIGRATIONS } from "@/lib/persistence/migrations";

beforeEach(() => {
  const stmts: string[] = [];
  __setImpl({
    async execute(q) {
      stmts.push(q);
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (q.startsWith("PRAGMA user_version"))
        return [{ user_version: 4 }] as unknown as T[];
      return [];
    },
    async close() {},
  });
});
afterEach(() => __resetImpl());

describe("migration v5", () => {
  it("adds a visibility_matrix TEXT column with default '{}'", () => {
    const m5 = MIGRATIONS[4];
    expect(m5).toBeDefined();
    expect(m5!.length).toBe(1);
    expect(m5![0]).toMatch(/ALTER TABLE conversations ADD COLUMN visibility_matrix/i);
    expect(m5![0]).toContain("DEFAULT '{}'");
  });
});
