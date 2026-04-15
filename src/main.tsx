import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

async function boot(): Promise<void> {
  // Outside the Tauri webview (E2E or `vite dev` in a browser),
  // install in-memory fakes for every native capability so the app is
  // fully functional without Rust or real providers.
  const inTauri = typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
  if (!inTauri) {
    const { installBrowserMocks } = await import("./lib/testing/installBrowserMocks");
    await installBrowserMocks();
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
