// ------------------------------------------------------------------
// Component: sql.js test adapter
// Responsibility: Implement SqlImpl using a real in-memory SQLite via
//                 sql.js (#157). Replaces the hand-matched regex-based
//                 mock that previously powered installBrowserMocks —
//                 means schema drift between tests and production is
//                 impossible (#145).
// Collaborators: lib/testing/installBrowserMocks.ts (consumer),
//                lib/persistence/migrations.ts (migration sequence
//                runs against this adapter via #158).
// ------------------------------------------------------------------

import initSqlJs, { type Database, type SqlValue } from "sql.js";
import type { SqlImpl } from "../tauri/sql";

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function loadSqlJs() {
  if (SQL) return SQL;
  SQL = await initSqlJs({
    // Vitest runs from the repo root and the e2e Vite dev server
    // serves node_modules at /node_modules, so the same path resolves
    // in both environments. If a future test environment changes
    // CWD, swap this to a fs.readFileSync of node_modules/.../sql-wasm.wasm.
    locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
  });
  return SQL;
}

export interface SqljsHandle {
  impl: SqlImpl;
  /** Underlying sql.js Database — exposed for migration setup + debugging. */
  db: Database;
  /** Releases the WASM memory. Tests should call this in afterEach. */
  reset: () => void;
}

/**
 * Build a fresh in-memory sql.js database wrapped in the SqlImpl shape
 * the production code expects. No data is loaded — callers run their
 * migration sequence immediately after this returns.
 */
export async function makeSqljsAdapter(): Promise<SqljsHandle> {
  const SqlEngine = await loadSqlJs();
  const db = new SqlEngine.Database();

  // sql.js stores the WASM-side rowid in a 64-bit integer, but the
  // SqlImpl contract returns a regular `number`. SQLite rowids fit in
  // 53 bits before that becomes a problem; tests stay well under.
  const lastInsertId = (): number | null => {
    const r = db.exec("SELECT last_insert_rowid()");
    const v = r[0]?.values[0]?.[0];
    return typeof v === "number" ? v : v == null ? null : Number(v);
  };

  const impl: SqlImpl = {
    async execute(sql, params = []) {
      // run() executes any non-SELECT (CREATE/ALTER/INSERT/UPDATE/DELETE)
      // and accepts optional positional/named params. plugin-sql exposes
      // only positional `?`, but the underlying repos use them, so the
      // parameter shape lines up directly.
      db.run(sql, params as SqlValue[]);
      const rowsAffected = db.getRowsModified();
      return { rowsAffected, lastInsertId: lastInsertId() };
    },
    async select(sql, params = []) {
      const stmt = db.prepare(sql, params as SqlValue[]);
      try {
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as Record<string, unknown>);
        }
        return rows as never[];
      } finally {
        stmt.free();
      }
    },
    async close() {
      db.close();
    },
  };

  return {
    impl,
    db,
    reset: () => db.close(),
  };
}
