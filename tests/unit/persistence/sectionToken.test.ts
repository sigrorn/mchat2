// #267 follow-up — pin the section-token contract for transactions.
//
// Background: v2.6.4's withSerializedSection used a module-scope flag
// (`inSerializedSection`). When a transaction set it true, ANY caller's
// sql.execute — including unrelated fire-and-forget DB writes — bypassed
// the queue. Under Tauri's pooled sqlx connection that landed concurrent
// writes on different pool connections, racing for the writer lock and
// surfacing as `code: 5 database is locked`. That's the v2.67.1 //pop
// regression: an external write firing from somewhere on the send hot
// path would race //pop's BEGIN IMMEDIATE.
//
// The fix: replace the global bypass with a section-scoped raw SqlImpl
// threaded into the section's body. The global `sql.execute` always
// queues — no exceptions. External callers wait their turn behind a
// running section. Section bodies use the threaded raw impl to issue
// their own statements, which bypass the queue (otherwise the section
// would deadlock waiting for itself).
//
// These tests pin that contract.

import { describe, it, expect, afterEach } from "vitest";
import { __setImpl, __resetImpl, sql, withSerializedSection } from "@/lib/tauri/sql";
import type { SqlImpl } from "@/lib/tauri/sql";
import { transaction, type TxnContext } from "@/lib/persistence/transaction";

afterEach(() => {
  __resetImpl();
});

interface RecordedOp {
  readonly q: string;
  readonly t: number;
}

/** Build a fake SqlImpl that records the order of execute calls. */
function recordingImpl(ops: RecordedOp[]): SqlImpl {
  return {
    async execute(q) {
      ops.push({ q, t: Date.now() });
      return { rowsAffected: 0, lastInsertId: null };
    },
    async select() {
      return [];
    },
    async close() {
      // no-op
    },
  };
}

describe("withSerializedSection — section-token contract", () => {
  it("hands the body a raw SqlImpl distinct from the global", async () => {
    __setImpl(recordingImpl([]));
    let receivedRaw: SqlImpl | undefined;
    await withSerializedSection(async (raw) => {
      receivedRaw = raw;
    });
    expect(receivedRaw).toBeDefined();
    // The raw impl is not the global re-export — it's the queue-bypassing
    // surface for the section body.
    expect(receivedRaw).not.toBe(sql);
  });

  it("queues an external sql.execute behind an active section (no bypass)", async () => {
    const ops: RecordedOp[] = [];
    __setImpl(recordingImpl(ops));

    // Run the section concurrently with an external sql.execute.
    // The section yields long enough for the external call to be
    // queued; the contract says the external must NOT execute until
    // the section completes.
    const sectionPromise = withSerializedSection(async (raw) => {
      await raw.execute("SECTION_START");
      // Yield twice to give the external call a fair chance to slip
      // through if the bypass is still live.
      await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 5));
      await raw.execute("SECTION_END");
    });

    // Schedule the external call after the section has started.
    // Tiny delay so the section's first statement runs first.
    await new Promise((r) => setTimeout(r, 1));
    const externalPromise = sql.execute("EXTERNAL");

    await Promise.all([sectionPromise, externalPromise]);

    // Order: section's writes commit first, external runs after.
    // Pre-fix this would be ["SECTION_START", "EXTERNAL", "SECTION_END"]
    // because EXTERNAL bypassed the queue.
    expect(ops.map((o) => o.q)).toEqual(["SECTION_START", "SECTION_END", "EXTERNAL"]);
  });

  it("the body's raw.execute calls bypass the queue (otherwise deadlock)", async () => {
    // Two raw.execute calls inside the section must not wait on each
    // other through the global op queue — the section already owns
    // the queue head. Pre-fix this worked via the global bypass; the
    // contract is preserved post-fix because the body uses the raw
    // impl directly, which doesn't enter the queue at all.
    const ops: RecordedOp[] = [];
    __setImpl(recordingImpl(ops));
    await withSerializedSection(async (raw) => {
      await raw.execute("A");
      await raw.execute("B");
    });
    expect(ops.map((o) => o.q)).toEqual(["A", "B"]);
  });
});

describe("transaction — TxnContext shape", () => {
  it("hands the body a TxnContext with sql + db", async () => {
    __setImpl(recordingImpl([]));
    let received: TxnContext | undefined;
    await transaction(async (ctx) => {
      received = ctx;
    });
    expect(received).toBeDefined();
    expect(received!.sql).toBeDefined();
    expect(received!.db).toBeDefined();
    // Sanity: the TxnContext.sql is the raw impl, not the global.
    expect(received!.sql).not.toBe(sql);
  });

  it("BEGIN/COMMIT issued via the raw impl, not the queued global", async () => {
    const ops: RecordedOp[] = [];
    __setImpl(recordingImpl(ops));

    await transaction(async (ctx) => {
      await ctx.sql.execute("WRITE_INSIDE_TXN");
    });

    // Order: BEGIN, WRITE_INSIDE_TXN, COMMIT — and all three came in
    // through the raw path, not the queued global.
    expect(ops.map((o) => o.q)).toEqual([
      "BEGIN IMMEDIATE",
      "WRITE_INSIDE_TXN",
      "COMMIT",
    ]);
  });

  it("a concurrent external sql.execute waits for the transaction to commit", async () => {
    const ops: RecordedOp[] = [];
    __setImpl(recordingImpl(ops));

    const txnPromise = transaction(async (ctx) => {
      await ctx.sql.execute("UPDATE_INSIDE");
      // Yield to let the external call attempt to slip through.
      await new Promise((r) => setTimeout(r, 5));
    });

    await new Promise((r) => setTimeout(r, 1));
    const externalPromise = sql.execute("UPDATE_OUTSIDE");

    await Promise.all([txnPromise, externalPromise]);

    // External update lands AFTER COMMIT, never between BEGIN and COMMIT.
    expect(ops.map((o) => o.q)).toEqual([
      "BEGIN IMMEDIATE",
      "UPDATE_INSIDE",
      "COMMIT",
      "UPDATE_OUTSIDE",
    ]);
  });
});
