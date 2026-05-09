// ------------------------------------------------------------------
// Component: Kysely instance + custom Dialect
// Responsibility: Bridges Kysely's Driver/Connection abstractions
//                 onto the existing async SqlImpl in lib/tauri/sql.
//                 Lets typed queries run against both the Rust SQL
//                 bridge (production) and sql.js (tests)
//                 without forking the test seam.
//                 #267: factored the dialect to bind to an arbitrary
//                 SqlImpl. The exported `db` is bound to the public
//                 (queued) sql; transactions get their own Kysely via
//                 `makeKyselyFor(raw)` bound to the raw impl so the
//                 transaction body's queries bypass the queue.
// Collaborators: lib/tauri/sql (the underlying impl), repo files
//                migrating to Kysely (#190, #191), schema.ts,
//                lib/persistence/transaction.ts (uses makeKyselyFor).
// ------------------------------------------------------------------

import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from "kysely";

import { sql as ourSql, type SqlImpl } from "../tauri/sql";
import type { Database } from "./schema";

class MchatKyselyConnection implements DatabaseConnection {
  constructor(private readonly impl: SqlImpl) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const isSelect =
      /^\s*(?:WITH\b[\s\S]*?)?SELECT\b/i.test(query.sql) || /\bRETURNING\b/i.test(query.sql);
    // SqlImpl.execute / .select type their second arg as `unknown[]`;
    // Kysely's compiled parameters are `readonly`, so a defensive
    // copy is the cleanest cross.
    const params = [...query.parameters];
    if (isSelect) {
      const rows = await this.impl.select<R>(query.sql, params);
      return { rows };
    }
    const result = await this.impl.execute(query.sql, params);
    const baseResult: QueryResult<R> = {
      rows: [],
      numAffectedRows: BigInt(result.rowsAffected),
    };
    if (result.lastInsertId !== null && result.lastInsertId !== undefined) {
      return { ...baseResult, insertId: BigInt(result.lastInsertId) };
    }
    return baseResult;
  }
  // Streaming isn't used by any current query path. Throw rather
  // than silently returning the buffered rows so a future caller
  // doesn't get fooled.
  async *streamQuery(): AsyncIterableIterator<never> {
    throw new Error("MchatKyselyDialect: streaming queries are not supported");
  }
}

class MchatKyselyDriver implements Driver {
  private connection: MchatKyselyConnection | null = null;
  constructor(private readonly impl: SqlImpl) {}
  async init(): Promise<void> {
    this.connection = new MchatKyselyConnection(this.impl);
  }
  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.connection) this.connection = new MchatKyselyConnection(this.impl);
    return this.connection;
  }
  // Transactions go through the SqlImpl directly today (see
  // lib/persistence/transaction.ts). Kysely's transaction API is
  // therefore opt-out: throw if a caller invokes db.transaction()
  // on the Kysely instance. The existing transaction() helper is
  // the supported surface.
  async beginTransaction(_conn: DatabaseConnection, _settings: TransactionSettings): Promise<void> {
    throw new Error(
      "MchatKyselyDialect: use lib/persistence/transaction#transaction() for transactions, not Kysely's transaction() API",
    );
  }
  async commitTransaction(): Promise<void> {
    throw new Error("MchatKyselyDialect: see beginTransaction note");
  }
  async rollbackTransaction(): Promise<void> {
    throw new Error("MchatKyselyDialect: see beginTransaction note");
  }
  async releaseConnection(): Promise<void> {
    // No-op: SqlImpl is global; nothing to release.
  }
  async destroy(): Promise<void> {
    this.connection = null;
  }
}

class MchatKyselyDialect implements Dialect {
  constructor(private readonly impl: SqlImpl) {}
  createAdapter() {
    return new SqliteAdapter();
  }
  createDriver(): Driver {
    return new MchatKyselyDriver(this.impl);
  }
  createIntrospector(db: Kysely<unknown>) {
    return new SqliteIntrospector(db);
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }
}

// Production Kysely — bound to the public queued `sql`. Every repo
// that imports `db` from here gets queued behavior.
export const db: Kysely<Database> = new Kysely<Database>({
  dialect: new MchatKyselyDialect(ourSql),
});

/**
 * Build a Kysely instance bound to a specific SqlImpl. Used by the
 * transaction helper to give the transaction body a queue-bypassing
 * Kysely (`TxnContext.db`) — without this, repo functions called
 * inside a transaction body would re-enter the queue and deadlock.
 *
 * Cheap to construct: Kysely is stateless; a fresh instance per
 * transaction is fine.
 */
export function makeKyselyFor(impl: SqlImpl): Kysely<Database> {
  return new Kysely<Database>({ dialect: new MchatKyselyDialect(impl) });
}
