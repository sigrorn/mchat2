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

// #206: Tauri's plugin-sql v2 wraps sqlx::SqlitePool with multiple
// connections (default 10), offers no after_connect hook, no
// `connect_with(SqliteConnectOptions)`, and rejects busy_timeout /
// journal_mode as URL params. Two pool connections concurrently
// running BEGIN IMMEDIATE collide as 'database is locked'; a stuck
// transaction on one pool connection from a prior failed COMMIT
// surfaces as 'cannot start a transaction within a transaction'.
//
// Workaround: serialize every db operation through one async queue.
// With no concurrent demand, sqlx's pool keeps returning its idle
// most-recently-released connection — effectively a single-connection
// pool from the JS side.
//
// Per-statement serialization ALONE doesn't atomically group multi-
// statement transactions: parallel transactions could interleave as
// BEGIN_A, BEGIN_B, DELETE_A, COMMIT_B, ... To handle that,
// `withSerializedSection` holds the queue for the entire duration of
// a multi-statement section (i.e. transaction(BEGIN/.../COMMIT)),
// and individual ops inside that section bypass the queue (they're
// already protected by the held lock).
let opQueue: Promise<unknown> = Promise.resolve();
let inSerializedSection = false;

function serializeOp<T>(fn: () => Promise<T>): Promise<T> {
  if (inSerializedSection) return fn();
  const next = opQueue.then(fn, fn);
  opQueue = next.catch(() => undefined);
  return next;
}

/**
 * Hold the global op queue for the duration of `fn`, so multi-step
 * transactions land sequentially and atomically on a single sqlx
 * pool connection. While inside the section, individual sql.execute
 * / sql.select calls bypass the queue (they would otherwise re-enter
 * and deadlock waiting on the queue they themselves hold).
 */
export function withSerializedSection<T>(fn: () => Promise<T>): Promise<T> {
  return serializeOp(async () => {
    inSerializedSection = true;
    try {
      return await fn();
    } finally {
      inSerializedSection = false;
    }
  });
}

const defaultImpl: SqlImpl = {
  async execute(sql, params) {
    return serializeOp(async () => {
      const db = await openDb();
      const r = await db.execute(sql, params);
      return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId ?? null };
    });
  },
  async select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return serializeOp(async () => {
      const db = await openDb();
      return db.select<T>(sql, params);
    });
  },
  async close() {
    return serializeOp(async () => {
      if (!cached) return;
      await (cached as SqliteDatabase).close();
      cached = null;
    });
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
