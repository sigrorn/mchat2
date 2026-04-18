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

// Module-level dedup: React 18 strict mode double-invokes effects,
// but migrations must not run concurrently. A shared promise ensures
// the boot sequence runs exactly once regardless of how many mounts fire.
let bootCache: Promise<void> | null = null;
function bootOnce(): Promise<void> {
  if (!bootCache) {
    bootCache = (async () => {
      if (!lifecycle.isTauri()) return;
      await runMigrations();
      await useConversationsStore.getState().load();
      await useUiStore.getState().loadFontScale();
      await useUiStore.getState().loadWorkingDir();
      // #107: set window title with build timestamp after Tauri init.
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setTitle(`mchat2 v${__BUILD_INFO__.timestamp}`);
      } catch {
        document.title = `mchat2 v${__BUILD_INFO__.timestamp}`;
      }
    })();
  }
  return bootCache;
}

export function App(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadConversations = useConversationsStore((s) => s.load);
  const loadFontScale = useUiStore((s) => s.loadFontScale);

  useEffect(() => {
    bootOnce()
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
