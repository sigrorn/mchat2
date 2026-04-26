import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
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
  if (__IS_DEV__) {
    const inTauri = typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
    if (!inTauri) {
      const { installBrowserMocks } = await import("./lib/testing/installBrowserMocks");
      await installBrowserMocks();
    }
  }
  const root = document.getElementById("root");
  if (!root) return;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
