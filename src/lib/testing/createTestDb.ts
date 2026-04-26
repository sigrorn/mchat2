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
}

/**
 * Build a fresh in-memory database, swap it in as the global SqlImpl,
 * run all production migrations, and return a handle. Each test gets
 * a clean schema-up-to-date DB.
 */
export async function createTestDb(): Promise<TestDbHandle> {
  const handle = await makeSqljsAdapter();
  __setImpl(handle.impl);
  await runMigrations();
  return {
    ...handle,
    restore: () => {
      handle.reset();
      __resetImpl();
    },
  };
}
