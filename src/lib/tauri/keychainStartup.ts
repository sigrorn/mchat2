// ------------------------------------------------------------------
// Component: Keychain startup migration
// Responsibility: Orchestrate the one-off Stronghold → OS-keychain
//                 copy (#35). Pure input surface — the caller supplies
//                 both KeychainImpls, a legacy-vault probe, and a
//                 rename hook, so the module is fully testable.
// Collaborators: keychainMigration (pure helper), keychain (legacy
//                probe + rename), app root (invoker).
// ------------------------------------------------------------------

import type { KeychainImpl } from "./keychain";
import { migrateKeychain, type MigrateResult } from "./keychainMigration";

export interface StartupInput {
  hasLegacy: () => Promise<boolean>;
  legacy: KeychainImpl;
  target: KeychainImpl;
  knownKeys: readonly string[];
  renameVault: () => Promise<void>;
}

export interface StartupOutcome {
  ran: boolean;
  result?: MigrateResult;
}

export async function runKeychainMigrationIfNeeded(
  input: StartupInput,
): Promise<StartupOutcome> {
  if (!(await input.hasLegacy())) {
    return { ran: false };
  }
  const result = await migrateKeychain({
    legacy: input.legacy,
    target: input.target,
    knownKeys: input.knownKeys,
  });
  // Rename only on a clean run — any per-key error means the user
  // can retry on the next launch without re-typing their keys.
  if (result.errors.length === 0) {
    await input.renameVault();
  }
  return { ran: true, result };
}
