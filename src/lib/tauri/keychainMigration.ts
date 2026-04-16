// ------------------------------------------------------------------
// Component: Keychain migration helper
// Responsibility: One-off copy of secrets from the legacy Stronghold
//                 vault to the OS-native keychain (issue #35). Pure —
//                 takes two KeychainImpl instances and a list of known
//                 keys, returns a structured outcome. The startup
//                 orchestrator decides what to do with it.
// Collaborators: tauri/keychain.ts (supplies both impls).
// ------------------------------------------------------------------

import type { KeychainImpl } from "./keychain";

export interface MigrateInput {
  legacy: KeychainImpl;
  target: KeychainImpl;
  knownKeys: readonly string[];
}

export interface MigrateResult {
  copied: string[];
  // Present in legacy but already set in target; we don't clobber.
  skipped: string[];
  // Not found in legacy (nothing to copy).
  missing: string[];
  // Per-key failures — legacy get or target set threw.
  errors: Array<{ key: string; message: string }>;
}

export async function migrateKeychain(input: MigrateInput): Promise<MigrateResult> {
  const copied: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  const errors: MigrateResult["errors"] = [];
  for (const key of input.knownKeys) {
    try {
      const legacyValue = await input.legacy.get(key);
      if (legacyValue === null) {
        missing.push(key);
        continue;
      }
      const existing = await input.target.get(key);
      if (existing !== null) {
        skipped.push(key);
        continue;
      }
      await input.target.set(key, legacyValue);
      copied.push(key);
    } catch (e) {
      errors.push({ key, message: (e as Error).message });
    }
  }
  return { copied, skipped, missing, errors };
}
