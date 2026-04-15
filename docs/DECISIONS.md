# Architecture decisions

Chronological log of non-trivial design decisions. Append new entries at the
bottom; do not rewrite history.

## 2026-04-15 — Initial scaffold

- **Tauri v2 over Electron.** Smaller bundle, native OS integration, first-class
  secure-storage/SQLite plugins.
- **TypeScript strict everywhere.** `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, no implicit any.
- **HTTP through a single abstraction (`lib/tauri/http.ts`).** Single mockable
  surface; adapters stay provider-specific only for SSE parsing.
- **Zustand, not Redux.** Stores are thin reactive wrappers; business logic
  lives in pure services under `lib/`.
- **Vitest + Playwright.** Vitest for pure TS, Playwright for the full Tauri
  webview via the mock provider.
