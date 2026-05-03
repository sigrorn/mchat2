import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installCrashLog } from "./lib/observability/crashLog";
import { dropApertusKeychainResidue } from "./lib/observability/dropApertusKeychainResidue";
import "./index.css";

async function boot(): Promise<void> {
  // Outside the Tauri webview (E2E or `vite dev` in a browser),
  // install in-memory fakes for every native capability so the app is
  // fully functional without Rust or real providers.
  //
  // #166: the outer `__IS_DEV__` gate is a build-time constant —
  // false in production Tauri builds — so Rollup eliminates the import
  // entirely and the mocks chunk never ships. The runtime !inTauri
  // check still guards `npm run tauri dev`, which runs vite-dev inside
  // the Tauri webview (so __IS_DEV__ is true but mocks must not load).
  let inTauri = false;
  if (__IS_DEV__) {
    inTauri = typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
    if (!inTauri) {
      const { installBrowserMocks } = await import("./lib/testing/installBrowserMocks");
      await installBrowserMocks();
    }
  } else {
    inTauri = true;
  }
  // Capture uncaught errors / unhandled promise rejections to
  // <appDataDir>/crash.log so post-mortem diagnosis on a `tauri build`
  // doesn't depend on devtools being open at the moment of failure.
  // Skipped under the browser fakes path (no Tauri fs plugin to write
  // through).
  if (inTauri) installCrashLog();
  // #259 Phase D: drop the orphaned apertus_api_key + apertus.productId
  // keychain entries left over from the native adapter. One-shot
  // best-effort cleanup; subsequent launches see an empty result and
  // skip the remove call.
  if (inTauri) void dropApertusKeychainResidue();
  const root = document.getElementById("root");
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
