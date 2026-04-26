// #156 — Spike to confirm sql.js boots in vitest's node environment.
//
// Loader pattern decision (recorded for #157 + #158):
//
//   import initSqlJs from "sql.js";
//   const SQL = await initSqlJs({
//     locateFile: (file) => `node_modules/sql.js/dist/${file}`,
//   });
//   const db = new SQL.Database();
//
// The locateFile callback is what tells the WASM loader where to find
// sql-wasm.wasm relative to the test's CWD. Vitest runs from the repo
// root, so node_modules/sql.js/dist is reachable by relative path.
// Production code never reaches this — sql.js is a devDependency and
// installBrowserMocks is a test-only module.

import { describe, it, expect } from "vitest";
import initSqlJs from "sql.js";

describe("sql.js boots in vitest node env (#156)", () => {
  it("opens an in-memory DB, runs CREATE/INSERT/SELECT cycle", async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database();

    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    db.run("INSERT INTO t (name) VALUES (?), (?), (?)", ["alice", "bob", "carol"]);

    const stmt = db.prepare("SELECT id, name FROM t ORDER BY id");
    const rows: Array<{ id: number; name: string }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { id: number; name: string };
      rows.push(row);
    }
    stmt.free();

    expect(rows).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
      { id: 3, name: "carol" },
    ]);

    db.close();
  });

  it("reports lastInsertRowid and changes() per real SQLite semantics", async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `node_modules/sql.js/dist/${file}`,
    });
    const db = new SQL.Database();
    db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    db.run("INSERT INTO t (v) VALUES (10)");
    const lastId1 = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
    expect(lastId1).toBe(1);

    db.run("INSERT INTO t (v) VALUES (20), (30)");
    const lastId2 = db.exec("SELECT last_insert_rowid() as id")[0]?.values[0]?.[0];
    expect(lastId2).toBe(3);

    db.run("UPDATE t SET v = v + 1 WHERE id <= 2");
    expect(db.getRowsModified()).toBe(2);

    db.close();
  });
});
