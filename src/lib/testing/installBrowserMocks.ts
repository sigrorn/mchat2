// ------------------------------------------------------------------
// Component: Browser mock installer
// Responsibility: Wire every lib/tauri/* module to an in-memory fake
//                 when running outside the Tauri webview. Powers the
//                 Playwright E2E suite and plain `vite dev` browsing
//                 for design work.
// Collaborators: lib/tauri/*, providers/registryOfAdapters (swaps in
//                mock adapter for all providers).
// ------------------------------------------------------------------

import { __setImpl as setSql } from "../tauri/sql";
import { __setImpl as setKc } from "../tauri/keychain";
import { __setImpl as setFs } from "../tauri/filesystem";
import { __setImpl as setLc } from "../tauri/lifecycle";
import { makeSqljsAdapter } from "./sqljsAdapter";

// --- in-memory SQL ---------------------------------------------------
// Powered by sql.js (real SQLite-via-WASM) as of #159. Schema is
// established by App.tsx's bootOnce -> runMigrations(); we just
// install the empty adapter here.
async function memSql(): Promise<void> {
  const handle = await makeSqljsAdapter();
  setSql(handle.impl);
}

// --- keychain / fs / lifecycle mocks --------------------------------
function memKeychain() {
  const store = new Map<string, string>();
  setKc({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    remove: async (k) => {
      store.delete(k);
    },
    list: async () => [...store.keys()],
  });
}

function memFs() {
  const store = new Map<string, string>();
  setFs({
    readText: async (p) => store.get(p) ?? "",
    writeText: async (p, c) => {
      store.set(p, c);
    },
    appendText: async (p, c) => {
      store.set(p, (store.get(p) ?? "") + c);
    },
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async (p) => store.has(p),
    mkdir: async () => {},
    copyFile: async () => {},
    removeFile: async () => {},
    saveDialog: async () => "/tmp/export.html",
    openDialog: async () => null,
  });
}

function memLifecycle() {
  // Claim we're Tauri so App.tsx runs migrations against our mem SQL.
  setLc({ isTauri: () => true, onBeforeUnload: () => () => {} });
}

// Force every provider to use the mock adapter so E2E runs offline.
async function installMockAdapters(): Promise<void> {
  const reg = await import("../providers/registryOfAdapters");
  const { mockAdapter } = await import("../providers/mock");
  for (const k of Object.keys(reg.ADAPTERS)) {
    (reg.ADAPTERS as Record<string, unknown>)[k] = mockAdapter;
  }
}

export async function installBrowserMocks(): Promise<void> {
  await memSql();
  memKeychain();
  memFs();
  memLifecycle();
  await installMockAdapters();
}
