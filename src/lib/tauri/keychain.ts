// ------------------------------------------------------------------
// Component: Keychain
// Responsibility: Read/write provider API keys via the OS-native
//                 keychain (#35). Replaces the Stronghold vault; the
//                 legacy Stronghold impl remains as a named export for
//                 the one-off migration path.
// Collaborators: src-tauri/src/keychain.rs (Rust commands),
//                providers/* (at call time), security/redact.ts,
//                keychainMigration.ts.
// ------------------------------------------------------------------

import { makeOsKeychainImpl } from "./keychainOs";

export interface KeychainImpl {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

const VAULT_CLIENT = "mchat2";

// OS-native default: Credential Manager on Windows, Keychain on macOS,
// Secret Service on Linux. Instantaneous compared to Stronghold, so
// the keychainBusy hint (#32) is no longer necessary for normal ops.
const defaultImpl: KeychainImpl = makeOsKeychainImpl(async (cmd, args) => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args) as unknown as never;
});

// Legacy Stronghold impl — retained only so the migration path (#35)
// can read the old vault one last time. Never wired as the default.
// If `$APPDATA/mchat2.stronghold` doesn't exist this impl's methods
// all return null/no-op. Callers should consult `hasStrongholdVault`
// first to avoid creating a fresh empty vault on disk.
let cachedHandle: Promise<{ sh: StrongholdInstance; store: StrongholdStore }> | null = null;

export async function hasStrongholdVault(): Promise<boolean> {
  const { appDataDir } = await import("@tauri-apps/api/path");
  const { exists } = await import("@tauri-apps/plugin-fs");
  const dir = await appDataDir();
  return exists(`${dir}/mchat2.stronghold`);
}

export const strongholdLegacyImpl: KeychainImpl = {
  async get(key) {
    const { store } = await openStronghold();
    try {
      const bytes = await store.get(key);
      return bytes ? new TextDecoder().decode(new Uint8Array(bytes)) : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    const { store, sh } = await openStronghold();
    await store.insert(key, Array.from(new TextEncoder().encode(value)));
    await sh.save();
  },
  async remove(key) {
    const { store, sh } = await openStronghold();
    await store.remove(key);
    await sh.save();
  },
  async list() {
    return [];
  },
};

function openStronghold(): Promise<{ sh: StrongholdInstance; store: StrongholdStore }> {
  if (cachedHandle) return cachedHandle;
  cachedHandle = doOpenStronghold().catch((e) => {
    cachedHandle = null;
    throw e;
  });
  return cachedHandle;
}

async function doOpenStronghold(): Promise<{ sh: StrongholdInstance; store: StrongholdStore }> {
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
  const { appDataDir } = await import("@tauri-apps/api/path");
  const dir = await appDataDir();
  const vaultPath = `${dir}/mchat2.stronghold`;
  const sh = (await Stronghold.load(vaultPath, VAULT_CLIENT)) as unknown as StrongholdInstance;
  let client: StrongholdClient;
  try {
    client = await sh.loadClient(VAULT_CLIENT);
  } catch {
    client = await sh.createClient(VAULT_CLIENT);
  }
  return { sh, store: client.getStore() };
}

interface StrongholdStore {
  get(key: string): Promise<number[] | null>;
  insert(key: string, value: number[]): Promise<void>;
  remove(key: string): Promise<number[] | null>;
}
interface StrongholdClient {
  getStore(): StrongholdStore;
}
interface StrongholdInstance {
  loadClient(name: string): Promise<StrongholdClient>;
  createClient(name: string): Promise<StrongholdClient>;
  save(): Promise<void>;
}

let impl: KeychainImpl = defaultImpl;

// The keychainBusy counter (#32) stays plumbed through because the
// legacy Stronghold migration path still benefits from the Composer
// hint. Steady-state OS-keychain calls are instant and add/remove a
// tick too fast to surface — the 300ms grace in the Composer hides it.
import { useUiStore } from "../../stores/uiStore";

async function withBusy<T>(op: () => Promise<T>): Promise<T> {
  useUiStore.setState((s) => ({ keychainBusy: s.keychainBusy + 1 }));
  try {
    return await op();
  } finally {
    useUiStore.setState((s) => ({ keychainBusy: Math.max(0, s.keychainBusy - 1) }));
  }
}

export const keychain = {
  get: (k: string) => withBusy(() => impl.get(k)),
  set: (k: string, v: string) => withBusy(() => impl.set(k, v)),
  remove: (k: string) => withBusy(() => impl.remove(k)),
  list: () => withBusy(() => impl.list()),
};

export function __setImpl(mock: KeychainImpl): void {
  impl = mock;
}

export function __resetImpl(): void {
  impl = defaultImpl;
}
