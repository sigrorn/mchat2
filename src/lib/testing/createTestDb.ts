// ------------------------------------------------------------------
// Component: Test database helper
// Responsibility: Boot a fresh sql.js in-memory database, install it
//                 as the SqlImpl, run the production migration sequence
//                 against it, and return a handle the test can use to
//                 reset between cases (#158).
// Collaborators: lib/testing/sqljsAdapter, lib/persistence/migrations,
//                lib/tauri/sql (__setImpl).
// ------------------------------------------------------------------

import { __setImpl, __resetImpl } from "../tauri/sql";
import { runMigrations } from "../persistence/migrations";
import { makeSqljsAdapter, type SqljsHandle } from "./sqljsAdapter";

export interface TestDbHandle extends SqljsHandle {
  /** Restores the production SqlImpl. Tests should call this in afterEach. */
  restore: () => void;
  /** Apply any migrations not yet run (used together with `stopAt`). */
  runRemainingMigrations: () => Promise<number>;
}

/**
 * Build a fresh in-memory database, swap it in as the global SqlImpl,
 * run all production migrations, and return a handle. Each test gets
 * a clean schema-up-to-date DB.
 *
 * `stopAt`: run only migrations 1..N. Useful when a test needs to seed
 * legacy data at an intermediate schema before the migration under
 * test runs (call `runRemainingMigrations` to apply the rest).
 */
export async function createTestDb(opts?: { stopAt?: number }): Promise<TestDbHandle> {
  const handle = await makeSqljsAdapter();
  __setImpl(handle.impl);
  await runMigrations(opts?.stopAt);
  return {
    ...handle,
    restore: () => {
      handle.reset();
      __resetImpl();
    },
    runRemainingMigrations: () => runMigrations(),
  };
}
