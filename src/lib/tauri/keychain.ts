// ------------------------------------------------------------------
// Component: Keychain
// Responsibility: Read/write provider API keys via the OS-native
//                 keychain (#35). Backed by Rust commands wrapping the
//                 keyring crate — Credential Manager on Windows,
//                 Keychain on macOS, Secret Service on Linux.
// Collaborators: src-tauri/src/keychain.rs (command handlers),
//                providers/* (at call time), security/redact.ts.
// ------------------------------------------------------------------

import { makeOsKeychainImpl } from "./keychainOs";

export interface KeychainImpl {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

const defaultImpl: KeychainImpl = makeOsKeychainImpl(async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as unknown as never;
});

let impl: KeychainImpl = defaultImpl;

export const keychain = {
  get: (k: string) => impl.get(k),
  set: (k: string, v: string) => impl.set(k, v),
  remove: (k: string) => impl.remove(k),
  list: () => impl.list(),
};

export function __setImpl(mock: KeychainImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
