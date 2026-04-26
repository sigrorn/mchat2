// #157 — Adapter must satisfy the SqlImpl contract that the repos
// rely on: positional param binding, lastInsertId after INSERT,
// rowsAffected after UPDATE/DELETE, plain-object row shape, multi-row
// SELECT.
import { describe, it, expect } from "vitest";
import { makeSqljsAdapter } from "@/lib/testing/sqljsAdapter";

describe("makeSqljsAdapter", () => {
  it("returns empty array for SELECT against empty table", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const rows = await impl.select<{ id: number; name: string }>("SELECT id, name FROM t");
    expect(rows).toEqual([]);
    reset();
  });

  it("returns rows as plain objects keyed by column name", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    await impl.execute("INSERT INTO t (name) VALUES (?), (?)", ["alice", "bob"]);
    const rows = await impl.select<{ id: number; name: string }>(
      "SELECT id, name FROM t ORDER BY id",
    );
    expect(rows).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
    reset();
  });

  it("binds positional ? parameters in execute", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    await impl.execute("INSERT INTO t (v) VALUES (?), (?), (?)", [10, 20, 30]);
    const rows = await impl.select<{ v: number }>(
      "SELECT v FROM t WHERE v > ? ORDER BY v",
      [15],
    );
    expect(rows).toEqual([{ v: 20 }, { v: 30 }]);
    reset();
  });

  it("returns lastInsertId after INSERT", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    const r1 = await impl.execute("INSERT INTO t (v) VALUES (?)", [10]);
    expect(r1.lastInsertId).toBe(1);
    const r2 = await impl.execute("INSERT INTO t (v) VALUES (?), (?)", [20, 30]);
    // sqlite reports the LAST id of a multi-row insert.
    expect(r2.lastInsertId).toBe(3);
    reset();
  });

  it("returns rowsAffected after UPDATE", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v INTEGER)");
    await impl.execute("INSERT INTO t (v) VALUES (?), (?), (?)", [10, 20, 30]);
    const r = await impl.execute("UPDATE t SET v = v + 1 WHERE v <= ?", [20]);
    expect(r.rowsAffected).toBe(2);
    reset();
  });

  it("returns rowsAffected after DELETE", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");
    await impl.execute("INSERT INTO t (id) VALUES (1), (2), (3)");
    const r = await impl.execute("DELETE FROM t WHERE id < ?", [3]);
    expect(r.rowsAffected).toBe(2);
    const remaining = await impl.select<{ id: number }>("SELECT id FROM t");
    expect(remaining).toEqual([{ id: 3 }]);
    reset();
  });

  it("preserves NULL values through the round-trip", async () => {
    const { impl, reset } = await makeSqljsAdapter();
    await impl.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    await impl.execute("INSERT INTO t (v) VALUES (?), (?)", ["x", null]);
    const rows = await impl.select<{ id: number; v: string | null }>(
      "SELECT id, v FROM t ORDER BY id",
    );
    expect(rows).toEqual([
      { id: 1, v: "x" },
      { id: 2, v: null },
    ]);
    reset();
  });
});
