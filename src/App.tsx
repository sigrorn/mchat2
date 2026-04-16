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

export function App(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadConversations = useConversationsStore((s) => s.load);

  useEffect(() => {
    (async () => {
      try {
        if (lifecycle.isTauri()) {
          await runMigrations();
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
