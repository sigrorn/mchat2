// ------------------------------------------------------------------
// Component: SQL
// Responsibility: Thin wrapper over @tauri-apps/plugin-sql. Exposes
//                 execute/select and a single open handle. All
//                 repositories share the same Database instance.
// Collaborators: persistence/*, tests inject a sql.js-backed impl via
//                __setImpl (see lib/testing/sqljsAdapter).
// ------------------------------------------------------------------

/**
 * Minimal SQLite client surface. Implementations must:
 *
 * - Bind positional `?` parameters in `params` order.
 * - Return rows as plain objects keyed by column name (so
 *   `select<T>` is structurally typed against T).
 * - Report `lastInsertId` as the rowid of the most recent INSERT,
 *   or `null` for non-INSERT executes.
 * - Report `rowsAffected` as the number of rows changed by the most
 *   recent statement (UPDATE / DELETE / INSERT).
 *
 * The production impl is plugin-sql; tests use the sql.js adapter
 * from lib/testing/sqljsAdapter.
 */
export interface SqlImpl {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId: number | null }>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

// Single shared SQLite file. WAL mode and foreign keys are set in the
// migration runner, not here, because plugin-sql doesn't expose PRAGMA
// on open.
const DB_URL = "sqlite:mchat2.db";

let cached: unknown = null;

async function openDb(): Promise<SqliteDatabase> {
  if (cached) return cached as SqliteDatabase;
  const Database = (await import("@tauri-apps/plugin-sql")).default;
  cached = await Database.load(DB_URL);
  return cached as SqliteDatabase;
}

interface SqliteDatabase {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<boolean>;
}

const defaultImpl: SqlImpl = {
  async execute(sql, params) {
    const db = await openDb();
    const r = await db.execute(sql, params);
    return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId ?? null };
  },
  async select(sql, params) {
    const db = await openDb();
    return db.select(sql, params);
  },
  async close() {
    if (!cached) return;
    await (cached as SqliteDatabase).close();
    cached = null;
  },
};

let impl: SqlImpl = defaultImpl;

export const sql = {
  execute: (q: string, p?: unknown[]) => impl.execute(q, p),
  select: <T = Record<string, unknown>>(q: string, p?: unknown[]) => impl.select<T>(q, p),
  close: () => impl.close(),
};

export function __setImpl(mock: SqlImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
