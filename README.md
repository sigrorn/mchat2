# mchat2

Multi-provider LLM chat workbench — a desktop application for power users who run
structured conversations across multiple providers (Claude, GPT, Gemini,
Perplexity, Mistral, Apertus) simultaneously.

It is not a chat wrapper. It is an orchestration workbench with named personas,
per-persona prompts/models/colors, DAG-style execution dependencies, visibility
controls, pinned context, retries, cost tracking, rich markdown/diagram
rendering, and HTML export.

## Status

From-scratch rewrite of a proven PySide6 Python app. Technology stack changed to
eliminate Qt threading instability and leverage web rendering for rich chat UI.

## Tech stack

- TypeScript (strict)
- Tauri v2 (minimal Rust; plugins for SQLite, secure storage, HTTP, FS)
- React 19 + TailwindCSS
- Zustand (state) — orchestration logic lives outside stores in pure services
- SQLite via `@tauri-apps/plugin-sql`
- Vitest (unit) + Playwright (E2E)
- Vite + Tauri CLI

## Setup

Prereqs: Node 20+, Rust stable, platform toolchain for Tauri
(see https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev   # dev build
npm run test        # vitest
npm run test:e2e    # playwright
npm run lint
```

## Project layout

```
src/
  lib/           Pure business logic (zero React/Tauri imports beyond lib/tauri/)
    types/       Domain types
    tauri/       All Tauri plugin + HTTP transport
    providers/   Registry + adapters (mock + real)
    orchestration/  sendPlanner, dagExecutor, streamRunner, retryManager
    context/     8-rule context builder
    personas/    CRUD, validation, @-prefix resolver
    persistence/ SQLite repositories + migrations
    rendering/   Shared markdown/code/graph pipeline + HTML export
    security/    Key redaction
    pricing/     Static cost table
    config.ts
  stores/        Zustand — thin reactive layer over services
  components/    React (presentation only)
  hooks/
src-tauri/       Rust entrypoint + plugin wiring (minimal)
tests/
  unit/          Vitest
  e2e/           Playwright
```

## Architecture notes

- **Orchestration outside stores.** Pure services in `lib/orchestration/` own
  business logic. Stores are thin reactive wrappers.
- **All Tauri + HTTP interop in `lib/tauri/`.** Nothing else imports Tauri APIs
  or calls `fetch()` directly. Provider adapters depend on
  `lib/tauri/http.ts#streamSSE`.
- **Provider registry is the single source of truth.** Derived maps
  (prefix→provider, color, display name, reserved names) are computed from it.
- **Keys never enter reactive state.** Read from keychain at call time, passed
  to `http.ts`, discarded.

See inline module docs and `CLAUDE.md` for the full design rules.
