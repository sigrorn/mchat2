// ------------------------------------------------------------------
// Component: SQL
// Responsibility: Thin wrapper over the app-owned SQLite bridge.
//                 Exposes execute/select and a single open handle.
//                 All repositories share the same Database instance.
// Collaborators: persistence/*, tests inject a sql.js-backed impl via
//                __setImpl (see lib/testing/sqljsAdapter).
// ------------------------------------------------------------------

import { invoke } from "@tauri-apps/api/core";

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
 * driver is whatever's been installed (production Rust bridge,
 * sql.js test adapter, or a unit-test mock).
 */
export interface SqlImpl {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowsAffected: number; lastInsertId: number | null }>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

// Single shared SQLite file. The Rust bridge opens it through a
// max-1 SQLx pool; WAL setup still happens in the migration runner.
const DB_URL = "sqlite:mchat2.db";

let loaded = false;

async function openDb(): Promise<void> {
  if (loaded) return;
  await invoke("sql_load", { db: DB_URL });
  loaded = true;
}

interface SqlExecuteResult {
  rowsAffected: number;
  lastInsertId: number | null;
}

// Production raw driver — talks to the Rust SQL bridge directly. No
// queue here; the queue lives in `sql` below. Tests swap this via
// __setImpl with the sql.js adapter (lib/testing/sqljsAdapter), which
// is also raw.
const productionRawImpl: SqlImpl = {
  async execute(query, params) {
    await openDb();
    return invoke<SqlExecuteResult>("sql_execute", {
      db: DB_URL,
      query,
      values: params ?? [],
    });
  },
  async select<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    await openDb();
    return invoke<T[]>("sql_select", {
      db: DB_URL,
      query,
      values: params ?? [],
    });
  },
  async close() {
    if (!loaded) return;
    await invoke("sql_close");
    loaded = false;
  },
};

let impl: SqlImpl = productionRawImpl;

// #206 / #267: all DB operations still flow through one async queue so
// top-level callers cannot interleave individual statements.
//
// #296: production no longer uses @tauri-apps/plugin-sql's default
// multi-connection pool. A transaction is a sequence of JS invokes
// (`BEGIN`, body statements, `COMMIT`); a pooled backend can run those
// invokes on different SQLite connections, where the body statement
// blocks behind the BEGIN connection's writer lock and eventually
// surfaces as `database is locked`. The Rust bridge uses
// max_connections = 1, so the queue and SQLite connection boundary
// now agree.
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
 * release. The body receives a raw SqlImpl that bypasses the global
 * queue; pass it (or a Kysely instance bound to it via TxnContext.db)
 * to any repo function the section calls, otherwise the queued repo
 * call deadlocks waiting on the section that holds the queue.
 *
 * #274: the raw impl ALSO has its own per-section chain so a body that
 * accidentally fires Promise.all (or push-then-await) over multiple
 * writes serializes them at the impl level. This preserves ADR 011's
 * "one await at a time" rule as a structural guarantee and keeps tests
 * honest even though production now also has a max-1 Rust pool.
 */
export function withSerializedSection<T>(
  fn: (raw: SqlImpl) => Promise<T>,
): Promise<T> {
  return queueOp(async () => {
    // Per-section chain. Each raw call enqueues onto sectionQueue so
    // its impl call only starts after the previous one has settled.
    // .catch(() => undefined) on the queue tail keeps it moving when a
    // chained call rejects — otherwise one failed write inside a
    // transaction would strand every subsequent write in the section.
    let sectionQueue: Promise<unknown> = Promise.resolve();
    const chain = <R>(op: () => Promise<R>): Promise<R> => {
      const next = sectionQueue.then(op, op);
      sectionQueue = next.catch(() => undefined);
      return next;
    };
    const raw: SqlImpl = {
      execute: (q, p) => chain(() => impl.execute(q, p)),
      select: <T = Record<string, unknown>>(q: string, p?: unknown[]): Promise<T[]> =>
        chain(() => impl.select<T>(q, p)),
      close: () => chain(() => impl.close()),
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
