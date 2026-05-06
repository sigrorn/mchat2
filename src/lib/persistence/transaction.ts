// ------------------------------------------------------------------
// Component: SQL transaction helper
// Responsibility: Wrap a caller-supplied async lambda in BEGIN IMMEDIATE
//                 / COMMIT, with ROLLBACK on throw. Multi-step mutations
//                 (#164) like replay-edit, //pop, //compact, and persona
//                 import use this so a mid-way failure leaves the DB in
//                 its pre-call state instead of a half-applied mess.
//                 #267: replaced the global-flag queue bypass with a
//                 section-token approach. The body now receives a
//                 TxnContext (raw sql + Kysely bound to the raw impl),
//                 which it threads to every repo it calls. External
//                 callers' sql.execute calls always queue and wait for
//                 the transaction to release.
// Collaborators: tauri/sql.ts (single shared SqlImpl), persistence/db.ts
//                (Kysely binder), every multi-step caller listed in
//                #164.
// ------------------------------------------------------------------

import { withSerializedSection, type SqlImpl } from "../tauri/sql";
import type { Kysely } from "kysely";
import type { Database } from "./schema";
import { makeKyselyFor } from "./db";

/**
 * Context handed to a transaction body. Use `ctx.sql` for raw
 * SqlImpl access (BEGIN/COMMIT/ROLLBACK + ad-hoc queries) and
 * `ctx.db` for typed Kysely access. Both bypass the global op
 * queue — only valid for the duration of the transaction body.
 */
export interface TxnContext {
  readonly sql: SqlImpl;
  readonly db: Kysely<Database>;
}

// SQLite has no nested transactions (only SAVEPOINTs, which we don't
// expose). Calling transaction() while already inside one is almost
// certainly a bug — usually a use case calling another use case that
// already wrapped its own writes — so we surface it loudly rather than
// silently flattening into the outer transaction.
let inTransaction = false;

export async function transaction<T>(fn: (ctx: TxnContext) => Promise<T>): Promise<T> {
  if (inTransaction) {
    throw new Error(
      "transaction(): nested call detected. SQLite has no nested transactions; refactor the inner caller to run outside its own transaction.",
    );
  }
  // #267: hold the SQL op queue for the entire BEGIN/.../COMMIT
  // section. The body's writes go through the raw impl (ctx.sql /
  // ctx.db), which bypasses the queue; external callers' sql.execute
  // calls land in the queue and wait for the transaction to release.
  return withSerializedSection(async (raw) => {
    await raw.execute("BEGIN IMMEDIATE");
    inTransaction = true;
    const ctx: TxnContext = { sql: raw, db: makeKyselyFor(raw) };
    try {
      const result = await fn(ctx);
      await raw.execute("COMMIT");
      return result;
    } catch (err) {
      try {
        await raw.execute("ROLLBACK");
      } catch {
        // If ROLLBACK itself fails we have nothing to recover with —
        // surface the original error, not the secondary one.
      }
      throw err;
    } finally {
      inTransaction = false;
    }
  });
}
