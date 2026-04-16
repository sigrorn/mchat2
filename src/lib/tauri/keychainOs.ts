// ------------------------------------------------------------------
// Component: OS keychain impl
// Responsibility: KeychainImpl backed by the Rust-side keyring crate
//                 (Windows Credential Manager / macOS Keychain / Linux
//                 Secret Service). Replaces Stronghold (#35).
// Collaborators: src-tauri/src/keychain.rs (command handlers).
// ------------------------------------------------------------------

import type { KeychainImpl } from "./keychain";

// Invoke factory — injected so unit tests can stub without vi.mocking
// the Tauri runtime module.
export type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export function makeOsKeychainImpl(invoke: InvokeFn): KeychainImpl {
  return {
    async get(key) {
      return invoke<string | null>("keychain_get", { key });
    },
    async set(key, value) {
      await invoke<void>("keychain_set", { key, value });
    },
    async remove(key) {
      await invoke<void>("keychain_remove", { key });
    },
    async list() {
      return invoke<string[]>("keychain_list");
    },
  };
}
