import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { MIGRATIONS, runMigrations } from "@/lib/persistence/migrations";

function makeMockSql(
  initialUserVersion = 0,
  opts: { failOn?: (q: string) => boolean } = {},
) {
  const statements: string[] = [];
  let committedUserVersion = initialUserVersion;
  let pendingUserVersion: number | null = null;
  let inTxn = false;
  __setImpl({
    async execute(q) {
      statements.push(q);
      if (/^\s*BEGIN/i.test(q)) {
        inTxn = true;
        pendingUserVersion = null;
        return { rowsAffected: 0, lastInsertId: null };
      }
      if (/^\s*COMMIT/i.test(q)) {
        if (pendingUserVersion !== null) committedUserVersion = pendingUserVersion;
        pendingUserVersion = null;
        inTxn = false;
        return { rowsAffected: 0, lastInsertId: null };
      }
      if (/^\s*ROLLBACK/i.test(q)) {
        pendingUserVersion = null;
        inTxn = false;
        return { rowsAffected: 0, lastInsertId: null };
      }
      if (opts.failOn?.(q)) throw new Error(`mock sql: forced failure on ${q}`);
      const m = /PRAGMA user_version\s*=\s*(\d+)/i.exec(q);
      if (m && m[1]) {
        if (inTxn) pendingUserVersion = Number(m[1]);
        else committedUserVersion = Number(m[1]);
      }
      return { rowsAffected: 0, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (/PRAGMA user_version/i.test(q)) {
        return [{ user_version: committedUserVersion } as unknown as T];
      }
      return [];
    },
    async close() {},
  });
  return { statements, getUserVersion: () => committedUserVersion };
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

  it("wraps each migration in BEGIN/COMMIT", async () => {
    const mock = makeMockSql(0);
    await runMigrations();
    const begins = mock.statements.filter((s) => /^\s*BEGIN/i.test(s));
    const commits = mock.statements.filter((s) => /^\s*COMMIT/i.test(s));
    expect(begins.length).toBe(MIGRATIONS.length);
    expect(commits.length).toBe(MIGRATIONS.length);
  });

  it("rolls back a failing migration and leaves user_version at the prior step", async () => {
    // Arrange: fail on the v2 ALTER that adds input_tokens. v1 should
    // commit, v2 should roll back.
    const mock = makeMockSql(0, {
      failOn: (q) => /ADD COLUMN input_tokens/i.test(q),
    });
    await expect(runMigrations()).rejects.toThrow();
    expect(mock.getUserVersion()).toBe(1);
    const rollbacks = mock.statements.filter((s) => /^\s*ROLLBACK/i.test(s));
    expect(rollbacks.length).toBeGreaterThanOrEqual(1);
    // The failing migration must not have COMMITTED after the failure.
    const v2Committed = mock.statements.some(
      (s) => /PRAGMA user_version = 2/i.test(s),
    );
    // PRAGMA may have been *emitted* (before COMMIT), but never committed,
    // so the observable user_version stays at 1.
    expect(mock.getUserVersion()).toBe(1);
    void v2Committed;
  });

  it("does not issue COMMIT after a failed migration", async () => {
    // Match against the latest migration's signature statement
    // (#260 adds inherited_history to personas).
    const mock = makeMockSql(MIGRATIONS.length - 1, {
      failOn: (q) => /ALTER TABLE personas ADD COLUMN inherited_history/i.test(q),
    });
    await expect(runMigrations()).rejects.toThrow();
    // After the failure, no further BEGIN/COMMIT pairs should appear.
    // Count COMMIT occurrences: there should be zero, since the only
    // migration attempted (the last one) failed and rolled back.
    const commits = mock.statements.filter((s) => /^\s*COMMIT/i.test(s));
    expect(commits.length).toBe(0);
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
