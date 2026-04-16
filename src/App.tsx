// ------------------------------------------------------------------
// Component: App root
// Responsibility: Initial DB bootstrap (migrations + load conversation
//                 list) and frame the two-pane layout.
// Collaborators: persistence/migrations.ts, stores/conversationsStore.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import { runMigrations } from "@/lib/persistence/migrations";
import { useConversationsStore } from "@/stores/conversationsStore";
import { lifecycle } from "@/lib/tauri/lifecycle";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import {
  hasStrongholdVault,
  strongholdLegacyImpl,
  keychain as keychainFacade,
} from "@/lib/tauri/keychain";
import { runKeychainMigrationIfNeeded } from "@/lib/tauri/keychainStartup";
import { ALL_PROVIDER_IDS, PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { APERTUS_PRODUCT_ID_KEY } from "@/lib/settings/keys";

export function App(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadConversations = useConversationsStore((s) => s.load);

  useEffect(() => {
    (async () => {
      try {
        if (lifecycle.isTauri()) {
          await runMigrations();
          // #35: one-off Stronghold → OS-keychain copy. Runs only when
          // the legacy vault file is present; renames it on success.
          await runKeychainMigrationIfNeeded({
            hasLegacy: hasStrongholdVault,
            legacy: strongholdLegacyImpl,
            target: {
              get: (k) => keychainFacade.get(k),
              set: (k, v) => keychainFacade.set(k, v),
              remove: (k) => keychainFacade.remove(k),
              list: () => keychainFacade.list(),
            },
            knownKeys: [
              ...ALL_PROVIDER_IDS.map((id) => PROVIDER_REGISTRY[id].keychainKey),
              APERTUS_PRODUCT_ID_KEY,
            ],
            renameVault: async () => {
              const { appDataDir } = await import("@tauri-apps/api/path");
              const { rename } = await import("@tauri-apps/plugin-fs");
              const dir = await appDataDir();
              await rename(`${dir}/mchat2.stronghold`, `${dir}/mchat2.stronghold.migrated`);
            },
          });
          await loadConversations();
        }
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })().catch((e) => setError(String(e)));
  }, [loadConversations]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-4 text-sm text-red-700">
        Startup error: {error}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  return (
    <div className="flex h-screen">
      <Sidebar />
      <ChatView />
    </div>
  );
}
