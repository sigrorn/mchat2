// ------------------------------------------------------------------
// Component: SQL transaction helper
// Responsibility: Wrap a caller-supplied async lambda in BEGIN IMMEDIATE
//                 / COMMIT, with ROLLBACK on throw. Multi-step mutations
//                 (#164) like replay-edit, //pop, //compact, and persona
//                 import use this so a mid-way failure leaves the DB in
//                 its pre-call state instead of a half-applied mess.
// Collaborators: tauri/sql.ts (single shared SqlImpl), every multi-step
//                caller listed in #164 — they import transaction() and
//                run their writes inside it.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";

// SQLite has no nested transactions (only SAVEPOINTs, which we don't
// expose). Calling transaction() while already inside one is almost
// certainly a bug — usually a use case calling another use case that
// already wrapped its own writes — so we surface it loudly rather than
// silently flattening into the outer transaction.
let inTransaction = false;

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (inTransaction) {
    throw new Error(
      "transaction(): nested call detected. SQLite has no nested transactions; refactor the inner caller to run outside its own transaction.",
    );
  }
  // #206: BEGIN must run BEFORE flipping the flag — otherwise a
  // 'database is locked' on BEGIN strands inTransaction at true and
  // every subsequent transaction() call mistakes it for a nested
  // entry. The finally that resets the flag only fires for entries
  // into the try block; an error from BEGIN escapes earlier.
  await sql.execute("BEGIN IMMEDIATE");
  inTransaction = true;
  try {
    const result = await fn();
    await sql.execute("COMMIT");
    return result;
  } catch (err) {
    try {
      await sql.execute("ROLLBACK");
    } catch {
      // If ROLLBACK itself fails we have nothing to recover with —
      // surface the original error, not the secondary one.
    }
    throw err;
  } finally {
    inTransaction = false;
  }
}
