// ------------------------------------------------------------------
// Component: App root
// Responsibility: Initial DB bootstrap (migrations + load conversation
//                 list) and frame the two-pane layout.
// Collaborators: persistence/migrations.ts, stores/conversationsStore.
// ------------------------------------------------------------------

import { useEffect, useState } from "react";
import { runMigrations } from "@/lib/persistence/migrations";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useUiStore } from "@/stores/uiStore";
import { nextScale } from "@/lib/ui/fontScale";
import { lifecycle } from "@/lib/tauri/lifecycle";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";

export function App(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadConversations = useConversationsStore((s) => s.load);
  const loadFontScale = useUiStore((s) => s.loadFontScale);

  useEffect(() => {
    (async () => {
      try {
        if (lifecycle.isTauri()) {
          await runMigrations();
          await loadConversations();
          await loadFontScale();
        }
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })().catch((e) => setError(String(e)));
  }, [loadConversations, loadFontScale]);

  // #50: Ctrl+/-/0 zoom for chat + composer. Intercept at the window
  // level so focus inside the textarea doesn't swallow the chords, and
  // preventDefault so the browser's own zoom doesn't also fire.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey) return;
      const store = useUiStore.getState();
      // #53: Ctrl+F opens the find bar. preventDefault so the webview's
      // own find (which doesn't work properly in Tauri's webview) doesn't
      // also fire.
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        store.openFind();
        return;
      }
      if (!e.ctrlKey || e.shiftKey) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        store.setFontScale(nextScale(store.chatFontScale, "up"));
      } else if (e.key === "-") {
        e.preventDefault();
        store.setFontScale(nextScale(store.chatFontScale, "down"));
      } else if (e.key === "0") {
        e.preventDefault();
        store.setFontScale(nextScale(store.chatFontScale, "reset"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
