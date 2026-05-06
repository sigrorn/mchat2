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
 * Implementations are raw drivers — they do NOT serialize. The op
 * queue lives one layer up, in the public `sql` export below; the
 * driver is whatever's been installed (production plugin-sql, sql.js
 * test adapter, or a unit-test mock).
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

// Production raw driver — talks to plugin-sql directly. No queue here;
// the queue lives in `sql` below. Tests swap this via __setImpl with
// the sql.js adapter (lib/testing/sqljsAdapter), which is also raw.
const productionRawImpl: SqlImpl = {
  async execute(sql, params) {
    const db = await openDb();
    const r = await db.execute(sql, params);
    return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId ?? null };
  },
  async select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const db = await openDb();
    return db.select<T>(sql, params);
  },
  async close() {
    if (!cached) return;
    await (cached as SqliteDatabase).close();
    cached = null;
  },
};

let impl: SqlImpl = productionRawImpl;

// #206 / #267: Tauri's plugin-sql v2 wraps sqlx::SqlitePool with multiple
// connections (default 10), offers no after_connect hook, no
// `connect_with(SqliteConnectOptions)`, and rejects busy_timeout /
// journal_mode as URL params. Two pool connections concurrently
// running BEGIN IMMEDIATE collide as 'database is locked'.
//
// Workaround: serialize every db operation through one async queue.
// With no concurrent demand, sqlx's pool keeps returning its idle
// most-recently-released connection — effectively a single-connection
// pool from the JS side.
//
// #267: the queue used to live inside the impl, with a global
// `inSerializedSection` flag that bypassed the queue while a
// transaction was open. Unrelated fire-and-forget DB writes hit
// that bypass and raced for the writer lock against the transaction.
// The queue now sits at the public `sql` export and admits NO
// bypass; sections receive a raw SqlImpl threaded into their body
// for their own writes.
let opQueue: Promise<unknown> = Promise.resolve();

function queueOp<T>(fn: () => Promise<T>): Promise<T> {
  const next = opQueue.then(fn, fn);
  opQueue = next.catch(() => undefined);
  return next;
}

/**
 * Public SQL surface. Every call queues — no exceptions. Everywhere
 * outside the body of a `withSerializedSection` / `transaction()` uses
 * this; the body itself receives a separate raw SqlImpl for its own
 * writes (otherwise it would deadlock waiting for the queue head it
 * already holds).
 */
export const sql: SqlImpl = {
  execute: (q, p) => queueOp(() => impl.execute(q, p)),
  select: <T = Record<string, unknown>>(q: string, p?: unknown[]): Promise<T[]> =>
    queueOp(() => impl.select<T>(q, p)),
  close: () => queueOp(() => impl.close()),
};

/**
 * Hold the global op queue for the duration of `fn`. Inside the body,
 * the section owns the queue head — external `sql.execute` /
 * `sql.select` calls land in the queue and wait for the section to
 * release. The body receives a raw SqlImpl that bypasses the queue;
 * pass it (or a Kysely instance bound to it via TxnContext.db) to
 * any repo function the section calls, otherwise the queued repo
 * call deadlocks waiting on the section that holds the queue.
 */
export function withSerializedSection<T>(
  fn: (raw: SqlImpl) => Promise<T>,
): Promise<T> {
  return queueOp(async () => {
    // Raw surface: routes through the currently-installed driver
    // (production / sql.js / mock) without re-entering queueOp.
    const raw: SqlImpl = {
      execute: (q, p) => impl.execute(q, p),
      select: <T = Record<string, unknown>>(q: string, p?: unknown[]): Promise<T[]> =>
        impl.select<T>(q, p),
      close: () => impl.close(),
    };
    return await fn(raw);
  });
}

export function __setImpl(mock: SqlImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = productionRawImpl;
}
