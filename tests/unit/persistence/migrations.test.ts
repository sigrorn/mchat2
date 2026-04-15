import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { MIGRATIONS, runMigrations } from "@/lib/persistence/migrations";

function makeMockSql(initialUserVersion = 0) {
  const statements: string[] = [];
  let userVersion = initialUserVersion;
  __setImpl({
    async execute(q) {
      statements.push(q);
      const m = /PRAGMA user_version\s*=\s*(\d+)/i.exec(q);
      if (m && m[1]) userVersion = Number(m[1]);
      return { rowsAffected: 0, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (/PRAGMA user_version/i.test(q)) {
        return [{ user_version: userVersion } as unknown as T];
      }
      return [];
    },
    async close() {},
  });
  return { statements, getUserVersion: () => userVersion };
}

describe("runMigrations", () => {
  afterEach(() => __resetImpl());

  it("applies all migrations from a fresh db", async () => {
    const mock = makeMockSql(0);
    const applied = await runMigrations();
    expect(applied).toBe(MIGRATIONS.length);
    expect(mock.getUserVersion()).toBe(MIGRATIONS.length);
    expect(mock.statements.some((s) => s.startsWith("PRAGMA foreign_keys"))).toBe(true);
    expect(mock.statements.some((s) => s.includes("CREATE TABLE conversations"))).toBe(true);
  });

  it("is a no-op when already at latest", async () => {
    const mock = makeMockSql(MIGRATIONS.length);
    const applied = await runMigrations();
    expect(applied).toBe(0);
    expect(mock.getUserVersion()).toBe(MIGRATIONS.length);
  });

  it("resumes from partial state", async () => {
    const mock = makeMockSql(MIGRATIONS.length - 1);
    const applied = await runMigrations();
    expect(applied).toBe(1);
    expect(mock.getUserVersion()).toBe(MIGRATIONS.length);
  });
});

// Keep the static shape of migrations stable.
describe("MIGRATIONS integrity", () => {
  beforeEach(() => {});
  it("first migration creates the four core tables", () => {
    const joined = MIGRATIONS[0]?.join("\n") ?? "";
    for (const t of ["conversations", "personas", "messages", "settings"]) {
      expect(joined).toContain(`CREATE TABLE ${t}`);
    }
  });
});
