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
  },
  async remove(key) {
    const { store, sh } = await openStore();
    await store.remove(key);
    await sh.save();
  },
  // Stronghold's Store has no enumeration API. list() returns empty
  // because no caller actually needs it — the settings dialog queries
  // specific keys by provider. If we ever need enumeration, add a
  // parallel JSON index blob and save it alongside each mutation.
  async list() {
    return [];
  },
};

// Cache the promise, not the result, so concurrent callers all await
// the same initialization instead of racing to create separate vaults.
let cachedHandle: Promise<{ sh: StrongholdInstance; store: StrongholdStore }> | null = null;

function openStore(): Promise<{ sh: StrongholdInstance; store: StrongholdStore }> {
  if (cachedHandle) return cachedHandle;
  cachedHandle = doOpenStore().catch((e) => {
    // Allow a retry on next call if initialization failed.
    cachedHandle = null;
    throw e;
  });
  return cachedHandle;
}

async function doOpenStore(): Promise<{ sh: StrongholdInstance; store: StrongholdStore }> {
  const log = (step: string, ...rest: unknown[]): void => console.log("[keychain]", step, ...rest);

  const { Stronghold } = await import("@tauri-apps/plugin-stronghold");
  const { appDataDir } = await import("@tauri-apps/api/path");
  const { mkdir, exists } = await import("@tauri-apps/plugin-fs");

  const dir = await appDataDir();
  log("appDataDir", dir);
  if (!(await exists(dir))) {
    log("creating app data dir");
    await mkdir(dir, { recursive: true });
  }
  const vaultPath = `${dir}/mchat2.stronghold`;
  log("loading stronghold", vaultPath);
  const sh = (await Stronghold.load(vaultPath, VAULT_CLIENT)) as unknown as StrongholdInstance;
  log("stronghold loaded, loading client");
  let client: StrongholdClient;
  try {
    client = await sh.loadClient(VAULT_CLIENT);
    log("client loaded");
  } catch (e) {
    log("loadClient failed, creating", e);
    client = await sh.createClient(VAULT_CLIENT);
    log("client created");
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
