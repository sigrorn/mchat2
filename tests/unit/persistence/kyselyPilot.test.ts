// Kysely pilot smoke test (#189): one typed query end-to-end through
// the custom MchatKyselyDialect against a real sql.js DB. Proves the
// dialect bridges async SqlImpl onto Kysely's sync-Driver expectation
// before #190 starts migrating messages.ts.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { db } from "@/lib/persistence/db";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("Kysely pilot (#189)", () => {
  it("round-trips a typed INSERT + SELECT through the custom dialect", async () => {
    handle = await createTestDb();
    await db
      .insertInto("settings")
      .values({ key: "ui.fontScale", value: "1.5" })
      .execute();
    const row = await db
      .selectFrom("settings")
      .select(["key", "value"])
      .where("key", "=", "ui.fontScale")
      .executeTakeFirst();
    expect(row).toEqual({ key: "ui.fontScale", value: "1.5" });
  });

  it("returns undefined for executeTakeFirst on no rows", async () => {
    handle = await createTestDb();
    const row = await db
      .selectFrom("settings")
      .selectAll()
      .where("key", "=", "missing")
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it("UPDATE reports numAffectedRows via Kysely's QueryResult", async () => {
    handle = await createTestDb();
    await db.insertInto("settings").values({ key: "a", value: "1" }).execute();
    const result = await db
      .updateTable("settings")
      .set({ value: "2" })
      .where("key", "=", "a")
      .executeTakeFirst();
    expect(Number(result.numUpdatedRows)).toBe(1);
  });

  it("supports parameterized WHERE clauses with proper binding", async () => {
    handle = await createTestDb();
    await db
      .insertInto("settings")
      .values([
        { key: "k1", value: "v1" },
        { key: "k2", value: "v2" },
        { key: "k3", value: "v3" },
      ])
      .execute();
    const rows = await db
      .selectFrom("settings")
      .select(["key", "value"])
      .where("key", "in", ["k1", "k3"])
      .orderBy("key")
      .execute();
    expect(rows).toEqual([
      { key: "k1", value: "v1" },
      { key: "k3", value: "v3" },
    ]);
  });
});
