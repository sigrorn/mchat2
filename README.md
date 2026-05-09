# mchat2

Multi-provider LLM chat workbench. A desktop application for users who run
structured conversations across several providers (Anthropic, OpenAI, Gemini,
OpenAI-compatible) at once.

Not a chat wrapper. An orchestration workbench with named personas, per-persona
prompts and models, conversation flows, visibility controls, pinned context,
retry/replay, cost tracking, rich Markdown rendering, and snapshot
import/export.

Built on Tauri 2 (minimal Rust shell) + React 19 + TypeScript + SQLite via
an app-owned SQLx bridge. Single-user, local-first, no backend service.

## Status

Single-developer project, which started as part of a personal learning journey with using AI coding (claude code, codex).
From-scratch rewrite of an earlier PySide6 Python app — the rewrite eliminated Qt threading instability and leveraged web rendering for the chat UI. Issues are filed before non-trivial work and the issue number drives the version bump (see
[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)).

Current version is in [`package.json`](package.json).

## Tech stack

- **TypeScript** (strict mode, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`)
- **Tauri 2** — minimal Rust; custom bridges for SQLite and secure storage,
  plus plugins for HTTP, FS, single-instance, dialogs, shell, window-state
- **React 19** + TailwindCSS
- **Zustand** for UI state — orchestration logic lives outside stores in pure
  use cases under `src/lib/app/`
- **SQLite** via a max-1 SQLx pool, queried through a thin Kysely layer
- **Vitest** (unit) + **Playwright** (end-to-end through the mock provider)

## Quick start

Prerequisites:

- Node 20+
- Rust stable (with `cargo` on PATH)
- OS-specific Tauri prerequisites — see [Tauri's setup
  guide](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
git clone <this-repo>
cd mchat2
npm install
npm run tauri dev      # dev build, hot-reloads the webview
npm test               # vitest unit suite
npm run test:e2e       # playwright (requires browsers installed)
npm run lint
npm run tauri build    # release binary
```

First launch will prompt for API keys per provider; keys are stored in your
OS keychain (Credential Manager on Windows, Keychain on macOS, Secret Service
on Linux). Provider keys never enter reactive state — they're read from the
keychain at call time and discarded after the request.

The SQLite database is created lazily on first launch under the OS app-data
directory.

## Project layout (1-level)

```
src/
  components/     React UI; reaches stores, never persistence directly (#287)
  hooks/          React hook layer that wires Zustand stores into use-case deps
  stores/         Zustand — thin reactive caches and UI state
  lib/            Pure logic; no React, no Zustand, no Tauri imports
src-tauri/        Rust shell — plugin wiring, single-instance, keychain/SQL bridges
tests/            Vitest unit suite + Playwright e2e
docs/             Architecture, contributing, troubleshooting, recipes, ADRs
```

A deeper map of `src/lib/` and the why-it's-shaped-this-way explanation lives
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

Read in this order on first contact:

1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — codebase tour. Process
   model, source map, data model, send/command lifecycles, persistence and
   locking rules, state/cache invariants. Read once on join.
2. **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — workflow rules. Issue-
   first, test-first, commit cadence, version-bump script. Reference daily.
3. **[docs/decisions/](docs/decisions/)** — Architecture Decision Records.
   Start with [docs/decisions/README.md](docs/decisions/README.md) for the
   recommended reading order.

When something breaks, look at:

- **[docs/troubleshooting.md](docs/troubleshooting.md)** — symptoms →
  diagnostic steps → fix patterns.
- **[docs/recipes.md](docs/recipes.md)** — how to add a slash command, a
  repo method, a migration, a provider, etc.
