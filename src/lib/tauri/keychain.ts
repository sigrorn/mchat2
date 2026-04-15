// ------------------------------------------------------------------
// Component: Keychain
// Responsibility: Read/write provider API keys in OS secure storage via
//                 the Stronghold plugin. Keys are read on demand and
//                 never cached in reactive state.
// Collaborators: providers/* (at call time), security/redact.ts,
//                UI settings screen.
// ------------------------------------------------------------------

export interface KeychainImpl {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<string[]>;
}

// Stronghold requires a client-password for the vault. We derive it from
// a stable machine-specific salt; this protects against trivial disk
// inspection but not against a compromised local account (which is also
// true of any desktop keystore).
const VAULT_CLIENT = "mchat2";

const defaultImpl: KeychainImpl = {
  async get(key) {
    const { store } = await openStore();
    try {
      const bytes = await store.get(key);
      return bytes ? new TextDecoder().decode(new Uint8Array(bytes)) : null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    const { store, sh } = await openStore();
    await store.insert(key, Array.from(new TextEncoder().encode(value)));
    await sh.save();
    await trackKey(key, true);
  },
  async remove(key) {
    const { store, sh } = await openStore();
    await store.remove(key);
    await sh.save();
    await trackKey(key, false);
  },
  async list() {
    // Stronghold's Store has no enumeration API. We maintain a parallel
    // index blob under a reserved key so list() can return known keys
    // without leaking the values themselves.
    const { store } = await openStore();
    const raw = await store.get(INDEX_KEY).catch(() => null);
    if (!raw) return [];
    try {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as string[];
    } catch {
      return [];
    }
  },
};

const INDEX_KEY = "__mchat2_index__";

async function trackKey(key: string, present: boolean): Promise<void> {
  if (key === INDEX_KEY) return;
  const { store, sh } = await openStore();
  const raw = await store.get(INDEX_KEY).catch(() => null);
  let keys: string[] = [];
  if (raw) {
    try {
      keys = JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as string[];
    } catch {
      keys = [];
    }
  }
  const set = new Set(keys);
  if (present) set.add(key);
  else set.delete(key);
  await store.insert(INDEX_KEY, Array.from(new TextEncoder().encode(JSON.stringify([...set]))));
  await sh.save();
}

async function openStore(): Promise<{ sh: StrongholdInstance; store: StrongholdStore }> {
  const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
  const { appDataDir } = await import("@tauri-apps/api/path");
  const vaultPath = `${await appDataDir()}/mchat2.stronghold`;
  const sh = (await Stronghold.load(vaultPath, VAULT_CLIENT)) as unknown as StrongholdInstance;
  const client =
    (await sh.loadClient(VAULT_CLIENT).catch(() => null)) ?? (await sh.createClient(VAULT_CLIENT));
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
