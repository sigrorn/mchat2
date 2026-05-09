# Architecture

A tour of the codebase, written for someone who's about to start reading or
modifying the code. Read once on join.

The goal of this document is not to enumerate every file — `ls` does that
fine — but to explain the *shapes* and the *why* behind the load-bearing
decisions, and to point you at the right ADR or source file when you need
to go deeper.

---

## Project overview

mchat2 is a Tauri 2 desktop application. Its job is to host structured
conversations with multiple LLM providers in parallel, with named personas,
per-persona system prompts and models, message-level addressing, and
conversation flows.

Three constraints shape every architectural decision:

1. **Single-user, local-first.** All state lives in one SQLite file under
   the OS app-data directory. No backend service to coordinate with. No
   multi-user write contention to engineer for. The flip side: the app *is*
   the database; if it crashes mid-write, the next launch needs to find a
   coherent DB.
2. **Streaming UI.** Every assistant reply streams tokens in real time,
   often from several providers in parallel. The data path has to keep up
   with the network without blocking the UI thread.
3. **Power-user surface.** Slash commands (`//pop`, `//compact`,
   `//visibility`, etc.), `@mention` addressing, conversation flows,
   replay, retry. The UI has to make these reliable and the data model has
   to support undoing them when they go wrong.

These three together set up the central tension the codebase keeps coming
back to: **how do we keep the streaming hot path fast without losing
write atomicity for multi-step user actions?** The answer evolves across
ADRs 002 and 011 and the issues that followed (#267, #274, #276, #278,
#282).

---

## Process model

mchat2 has two processes plus a database file:

```
┌────────────────────────────────────┐         ┌─────────────────────┐
│  Tauri shell  (src-tauri/, Rust)   │         │  OS keychain        │
│                                    │  IPC    │  (Windows / macOS / │
│  - main.rs / lib.rs                │ ──────▶ │   Linux secrets)    │
│  - keychain bridge                 │         └─────────────────────┘
│  - sql_bridge.rs (SQLx, max-1 pool)│
│  - tauri-plugin-single-instance    │         ┌─────────────────────┐
│                                    │  file   │  mchat2.db          │
│                                    │ ──────▶ │  (SQLite, WAL)      │
└────────┬───────────────────────────┘         └─────────────────────┘
         │ IPC (Tauri commands + plugins)
         ▼
┌────────────────────────────────────┐         ┌─────────────────────┐
│  Webview  (src/, React + TS)       │  HTTPS  │  LLM providers      │
│                                    │ ──────▶ │  (Anthropic, OpenAI,│
│  All app logic lives here:         │         │   Gemini, …)        │
│  - components / hooks / stores     │         └─────────────────────┘
│  - lib/app, lib/orchestration,     │
│    lib/persistence, lib/personas   │
└────────────────────────────────────┘
```

### Why this split

The Rust shell is intentionally **thin**. It exposes plugins (HTTP, FS,
dialogs, single-instance, shell/window state) plus small custom bridges
for SQLite and keychain access. Everything else — orchestration,
validation, business logic, even most input parsing — lives in TypeScript
inside the webview.

This is a deliberate choice from ADR 008 (lessons from the Python/Qt
prototype): keeping logic in TypeScript means we can unit-test it
without spinning up the Tauri runtime, swap the SQL impl for an
in-memory `sql.js` adapter in tests, and avoid the cross-language
plumbing that made the Python/Qt version brittle.

### What runs where

- **`src-tauri/src/lib.rs`** — registers plugins. The single-instance
  plugin is registered first so a second `mchat2.exe` invocation is
  intercepted before it can open the DB file (#284). Read this file
  to understand how plugins are wired.
- **`src-tauri/src/keychain.rs`** — custom keychain commands. The
  `keyring` crate doesn't have a published Tauri plugin, so the bridge is
  hand-written: `keychain_get`, `keychain_set`, `keychain_remove`,
  `keychain_list`.
- **`src-tauri/src/sql_bridge.rs`** — custom SQLite commands backed by
  SQLx with `max_connections = 1`. This replaces plugin-sql for the
  production `SqlImpl` so JS transaction sections cannot hop across
  pooled SQLite connections (#296).
- **`src/main.tsx`** — webview entry point. Mounts `<App />`.
- **`src/App.tsx`** — top-level layout: sidebar, chat view, persona
  panel.
- **`src/lib/tauri/`** — every IPC call. The rule is that nothing in
  `src/lib/` (outside `src/lib/tauri/`) imports from `@tauri-apps/*`.
  This keeps the lib layer mockable and is enforced by ESLint per
  ADR 001.

### Database file lifecycle

- Created lazily on first launch via the `sql_load("sqlite:mchat2.db")`
  command called from [`src/lib/tauri/sql.ts`](../src/lib/tauri/sql.ts).
- Lives under the OS app-data directory.
- WAL mode is enabled at startup (in `runMigrations`) for concurrent-
  reader semantics.
- `busy_timeout = 5000` is set on the SQLx connection. The production
  pool is intentionally capped at one connection so `BEGIN` / body /
  `COMMIT` sections stay on the same SQLite handle.

---

## Repository map

The webview is the project. Everything under `src/`:

```
src/
  components/         React UI (presentation only)
  hooks/              React hook layer wiring stores → use-case deps
  stores/             Zustand: thin reactive caches and UI state
  lib/                Pure logic; no React, no Zustand, no Tauri imports
    app/              Use cases (sendMessage, replay, pop, compact, …)
    commands/         //slash command handlers + dispatcher
      handlers/       One file per command family
    composer/         Composer input state, @mention completion
    context/          buildContext: messages + persona → LLM context
    conversations/    Conversation-level workflows (compact, snapshot,
                      forks, runs-after migration, autotitle)
    data/             Repo-query cache used by hooks (not the persistence
                      layer; it's the React-Query–style abstraction)
    flows/            Flow advance / pause / rewind logic
    observability/    Structured logging, backgroundTask helper
    orchestration/    Stream runner, send planner, run/replay/retry
                      record-keeping
    persistence/      Kysely-backed repos, schema, migrations, transactions
    personas/         Service, validation, identity pin, visibility
                      rebuild, file ops (import/export)
    pricing/          Static pricing table for cost tracking
    providers/        Anthropic / OpenAI / Gemini / OpenAI-compat adapters,
                      registry, model lists, OpenAI-compat presets
    rendering/        Markdown / code / diagram pipeline + HTML export
    schemas/          Zod schemas at trust boundaries (snapshot, settings,
                      conversation JSON columns) — see ADR 003
    security/         Key redaction
    settings/         Settings keys + parsers
    tauri/            All @tauri-apps/* imports + HTTP / FS / SQL surfaces
    testing/          Test seams: createTestDb, sqljsAdapter
    tracing/          Trace file writer (used when tracing is on)
    types/            Domain types — Conversation, Persona, Message, Flow…
    ui/               findMatches, userMessageNav — shared UI helpers
                      that live in lib/ because they're pure logic
src-tauri/
  src/
    main.rs           Bootstrap
    lib.rs            Plugin registration + single-instance callback
    keychain.rs       OS keychain bridge
  Cargo.toml
tests/
  unit/               Vitest, organized by source-tree mirror
  e2e/                Playwright through the mock provider
docs/                 You are here
scripts/
  bump-version.mjs    Issue-based versioning script
  bumpLogic.mjs       Shared logic (also imported by tests)
```

The boundary is enforced in two places by ESLint
([eslint.config.js](../eslint.config.js)):

1. **`src/lib/**`** may not import from `@/stores/*`, `@/hooks/*`, or
   `@tauri-apps/*` directly. Use cases take store actions via `*Deps`
   parameters (#142, #144, #155); raw Tauri APIs go through the
   `@/lib/tauri/*` shim.
2. **`src/components/**`** may not import from `@/lib/persistence/*`.
   Components reach for stores
   (`conversationsStore`, `messagesStore`, `personasStore`,
   `flowsStore`, `uiStore`) instead. The store methods are thin
   pass-throughs — they don't add caching beyond what `useRepoQuery`
   already does — but they put the seam where it belongs (see #287
   for the rationale and the rollout, phases 1–3).

These two rules are why the codebase is testable without React, why
the test seam in `lib/testing/createTestDb.ts` works, why the
section-token locking discipline from ADR 011 can be enforced
uniformly, and why component tests only need to fake stores rather
than the whole persistence layer. See
[ADR 001](decisions/001-lib-app-boundary.md) for the full rationale.

---

## Core layering

```
┌──────────────────────────────────────────────────────────────┐
│  components/                                                 │
│  React. Render conversation, composer, persona panel,        │
│  message bubbles. Calls into hooks for data and actions.     │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  hooks/                                                      │
│  React glue. Wires Zustand stores and lib/tauri/ into the    │
│  *Deps shapes that lib/app/ use cases need. Examples:        │
│    src/hooks/sendMessageDeps.ts → SendMessageDeps            │
│    src/hooks/commandDeps.ts → CommandDeps                    │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  stores/                                                     │
│  Zustand. Cache + UI state + thin actions. Each store owns a │
│  domain: conversations, messages, personas, send-state, ui.  │
│  Persistent writes go through repos; cache reads come from   │
│  the repo-query cache.                                       │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/app/                                                    │
│  Use cases as plain async functions. Each takes a *Deps      │
│  parameter (see ADR 005) and returns a result. No store      │
│  imports, no React, no @tauri-apps/* imports.                │
│    sendMessage, replayMessage, retryMessage, runPlannedSend, │
│    runOneTarget, postResponseCheck, reorderPersonas, …       │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/orchestration/, lib/conversations/, lib/personas/, …    │
│  Domain logic: planning sends, streaming, compaction,        │
│  recording runs/attempts, persona services, identity pin,    │
│  visibility rebuild.                                         │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/persistence/                                            │
│  Kysely-backed repos, schema, migrations, transactions.      │
│  Every repo function takes optional dbi: Kysely<Database>.   │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/tauri/                                                  │
│  SQL surface (sql.ts), HTTP transport (http.ts), filesystem  │
│  (filesystem.ts), keychain (keychain.ts), single-instance.   │
│  The only files that may import from @tauri-apps/*.          │
└──────────────────────────────────────────────────────────────┘
```

### How the layers communicate

- **Components → hooks.** A component calls `useSend(conversation)`,
  `useDispatchCommand(conversation)`, etc. The hook returns callbacks.
- **Hooks → use cases.** The hook constructs a `*Deps` object from
  Zustand store getters and `lib/tauri/` calls, then calls the use case
  function with `(deps, args)`.
- **Use cases → domain.** Use cases call domain logic and persistence
  repos directly. They don't reach back into stores; they return data
  and the hook layer pushes that into stores.
- **Stores → repos.** Store actions call persistence repos to mutate
  disk state, then update the Zustand cache (or the repo-query cache,
  for query-style data).

The crucial idea is that **state changes flow downward** (components
trigger use cases, use cases mutate disk, hooks push into stores) and
**data flows upward** (repos load from disk, stores cache, components
render). This avoids the bidirectional sprawl that earlier hook-only
versions of the code had — see ADR 001.

---

## Data model

The DB has these top-level tables. Foreign keys are denoted with `→`:

```
conversations            One row per conversation. Title, system prompt,
                         display mode, autocompact threshold,
                         compaction floor, last_seen_at, last_message_at.
                         Junction tables (below) hold list-shaped state.

  conversation_personas_selected    (conv_id → conversations.id,
                                     persona_id → personas.id)
                                    Currently-selected personas in the UI.
  conversation_context_warnings     (conv_id → conversations.id,
                                     threshold)
                                    Which 80/90/98% warnings have fired.
  persona_visibility                (conv_id, observer_slug, source_slug,
                                     visible)
                                    Sparse "who sees who" matrix
                                    (slug-keyed for migration safety).
personas                 One row per persona, soft-deleted (deleted_at).
                         conv_id → conversations.id. Sort order, name
                         slug (unique among non-tombstoned siblings),
                         provider, model override, system prompt
                         override, color, visibility defaults JSON,
                         openai-compat preset, role lens.

messages                 One row per chat message. conv_id → conversations.
                         id, persona_id → personas.id (nullable for user
                         and notice rows). idx for ordering (UNIQUE per
                         conv); content; role (user / assistant / notice
                         / system); flow_dispatched flag; created_at;
                         input_tokens, output_tokens, cost_usd, ttft_ms,
                         stream_ms; superseded_at (set when an older
                         attempt is replaced by replay/retry); confirmed_at
                         (notice confirm-and-hide).

flows                    One row per conversation flow. conv_id →
                         conversations.id. JSON-encoded steps array,
                         current_step_index, loop_start_index.

runs                     A "run" is one invocation of the LLM (one send,
                         one replay, one retry, one compaction). Captures
                         conv_id, the user message that triggered it,
                         the flow_step_id (if dispatched by a flow),
                         created_at.
  run_targets            One row per (run, target_persona) pair.
  attempts               Each attempt has its associated assistant message
                         id, success status, error info. Replay/retry
                         create new attempts that supersede prior ones.

settings                 Generic (key, value) store for global app
                         settings (system prompt, working dir, autotitle
                         enable, etc.).
```

### Key invariants

- **`messages.idx` is unique per conversation.** It's the canonical
  ordering. New messages get `MAX(idx) + 1`; compaction shifts the tail
  to open a gap.
- **Personas are soft-deleted.** Tombstoning sets `deleted_at`; the row
  stays so historical messages keep their `persona_id` reference. The
  unique constraint on `(conversation_id, name_slug)` only applies to
  rows where `deleted_at IS NULL`, so a name can be reused after delete.
- **Messages can be superseded but never hard-deleted by replay or
  retry.** `superseded_at` hides them from the UI and from
  `buildContext`, but they stay in the DB so the attempt-history
  affordance can show them.
- **The `conversations.visibility_matrix` JSON column is dual-written**
  alongside `persona_visibility` for rollback safety, but reads come
  from the relational form. This is a transitional state from #202;
  see ADR 006 for the data-layer rationale.

The schema is hand-written in
[`src/lib/persistence/schema.ts`](../src/lib/persistence/schema.ts) and
fed to Kysely for typed query construction (ADR 007). Migrations are in
[`src/lib/persistence/migrations.ts`](../src/lib/persistence/migrations.ts);
each entry in the `MIGRATIONS` array runs once, gated by SQLite's
`user_version` PRAGMA. See the [Add a migration](recipes.md#add-a-migration)
recipe for the authoring pattern.

---

## Messaging lifecycle

This is the most-traveled code path in the app. End-to-end trace of
a "user types text and hits Enter" event:

### 1. Composer parse

[`src/components/Composer.tsx`](../src/components/Composer.tsx) owns the
input field. On submit, it calls `useSend(conversation).send(text)`.

### 2. Use case entry

[`src/hooks/useSend.ts`](../src/hooks/useSend.ts) wires deps and calls
[`sendMessage`](../src/lib/app/sendMessage.ts). The function:

1. Calls `resolveTargets({ text, personas, selection })` from
   [`src/lib/personas/resolver.ts`](../src/lib/personas/resolver.ts).
   This finds explicit `@mentions` in the text, strips them, and returns
   either an explicit target list or a fallback to the current selection.
2. If a flow is attached and the resolved targets match the next
   `personas` step, the flow cursor advances and we record the
   `flow_step_id` on the run (#217).
3. Persists the user row via `deps.appendUserMessage`. This is the
   conversationsStore action that calls
   [`messagesRepo.appendMessage`](../src/lib/persistence/messages.ts).
   On the non-transaction path, `appendMessage` wraps three statements
   (SELECT MAX(idx), INSERT, UPDATE conversations.last_message_at) in a
   `withSerializedSection` so a concurrent transaction can't sneak
   between them (#276).

### 3. Plan and dispatch

[`runPlannedSend`](../src/lib/app/runPlannedSend.ts) takes the resolved
targets and calls [`runOneTarget`](../src/lib/app/runOneTarget.ts) once
per target — in parallel via `Promise.all`. Each `runOneTarget`:

1. Inserts an assistant placeholder row (`appendAssistantPlaceholder`)
   with `index = nextIdx` and empty content.
2. Calls the provider adapter via
   [`streamRunner`](../src/lib/orchestration/streamRunner.ts).
3. Pumps tokens into the placeholder via `patchContent` (in-memory only
   — DB writes happen at finalization, not per token).

### 4. Stream

[`streamRunner`](../src/lib/orchestration/streamRunner.ts) is the heart
of the streaming path. It:

1. Builds the context for this target via
   [`buildContext`](../src/lib/context/index.ts). Context construction
   is its own complex topic — eight rules about which messages are
   visible to which persona, which are excluded by `addressedTo`, which
   are superseded, etc. Read
   [`src/lib/context/`](../src/lib/context/) when you need to dig into
   it.
2. Resolves API keys via the keychain bridge — keys never enter
   reactive state. They're read at call time and discarded.
3. Calls the provider adapter from
   [`src/lib/providers/registryOfAdapters.ts`](../src/lib/providers/registryOfAdapters.ts).
   The adapter yields `ProviderStreamEvent` values (`token`, `usage`,
   `error`).
4. Buffers tokens (per `shouldBufferTokens.ts`) and patches the
   placeholder's content as they arrive. The buffering policy throttles
   updates so we don't reflow on every keystroke-equivalent.
5. On stream completion, calls
   [`finalizeAssistantMessage`](../src/lib/persistence/messages.ts)
   which writes content + usage + cost + timing in **one** UPDATE
   messages + one UPDATE conversations.last_message_at, both behind a
   held section (#282). Pre-#282 this was 4-6 separate queued UPDATEs
   per stream completion.
6. Records the run / target / attempt rows via `recordSend`.
7. Treats a "silent" stream (no tokens, no usage, no error) as a failure
   so the bubble doesn't end up blank with no signal (#26/#27).

### 5. Post-response check

After all targets finish, [`postResponseCheck`](../src/lib/app/postResponseCheck.ts)
runs. It computes per-persona context usage, fires any pending
80/90/98% warnings, and triggers autocompaction if any persona crosses
its threshold.

### 6. Auto-title

If this was the first reply in the conversation, `generateTitle` (in
[`src/lib/conversations/autoTitle.ts`](../src/lib/conversations/autoTitle.ts))
fires asynchronously to ask one of the configured providers for a
short title.

### Key files for the messaging lifecycle

| Step | File |
| --- | --- |
| Composer | [`src/components/Composer.tsx`](../src/components/Composer.tsx) |
| Hook layer | [`src/hooks/useSend.ts`](../src/hooks/useSend.ts) |
| Use case | [`src/lib/app/sendMessage.ts`](../src/lib/app/sendMessage.ts) |
| Target resolution | [`src/lib/personas/resolver.ts`](../src/lib/personas/resolver.ts) |
| Append user row | [`src/lib/persistence/messages.ts`](../src/lib/persistence/messages.ts) |
| Plan and dispatch | [`src/lib/app/runPlannedSend.ts`](../src/lib/app/runPlannedSend.ts), [`runOneTarget.ts`](../src/lib/app/runOneTarget.ts) |
| Stream | [`src/lib/orchestration/streamRunner.ts`](../src/lib/orchestration/streamRunner.ts) |
| Context build | [`src/lib/context/`](../src/lib/context/) |
| Finalize | `finalizeAssistantMessage` in [`src/lib/persistence/messages.ts`](../src/lib/persistence/messages.ts) |
| Post-response check | [`src/lib/app/postResponseCheck.ts`](../src/lib/app/postResponseCheck.ts) |
| Auto-title | [`src/lib/conversations/autoTitle.ts`](../src/lib/conversations/autoTitle.ts) |

---

## Command lifecycle

Slash commands (`//pop`, `//compact`, `//visibility`, `//fork`, etc.)
follow a similar shape to messaging but with different write semantics
and different atomicity needs.

### Dispatch

The composer recognizes leading `//` and routes the input to
[`dispatch.ts`](../src/lib/commands/dispatch.ts). Dispatch:

1. Parses the command name and arguments via `parseCommand`.
2. Validates against the spec defined in
   [`specs.ts`](../src/lib/commands/specs.ts) (Zod-typed; commands are
   a Zod trust boundary per ADR 003).
3. Constructs a `CommandContext` from the current conversation and the
   `CommandDeps` wired by `src/hooks/commandDeps.ts`.
4. Calls the matching handler under
   [`src/lib/commands/handlers/`](../src/lib/commands/handlers/).

### Handlers and atomicity

Each handler decides its own write strategy. Examples:

- **`//pop`** (history.ts) wraps the multi-step truncate-and-rewind
  in a `transaction()` so the message deletion + flow-cursor rewind +
  attempt-supersede land or roll back together.
- **`//compact`** (compaction.ts) calls `runCompaction`, which itself
  splits into LLM phase (outside any transaction) and DB-commit phase
  (`runCompactionCommit` runs inside one transaction). The handler
  glues them together and reloads caches afterward.
- **`//visibility`** (visibility.ts) calls
  `rebuildVisibilityFromPersonaDefaults` (which writes the
  `persona_visibility` table + the legacy JSON column inline) and then
  nudges the cache via `applyVisibilityMatrixCache` (#279) — no extra
  DB rewrite.
- **`//fork`** (fork.ts) creates a new conversation row, copies
  personas, copies messages up to the fork point, copies the flow if
  any. Wrapped in a transaction.

### Errors

Command handler errors surface as `notice` rows in the chat (via
`appendNotice`). The composer doesn't display command-level errors
inline; they're treated as part of the conversation history.

### Key files for the command lifecycle

| Step | File |
| --- | --- |
| Dispatch | [`src/lib/commands/dispatch.ts`](../src/lib/commands/dispatch.ts) |
| Parse | [`src/lib/commands/parseCommand.ts`](../src/lib/commands/parseCommand.ts) |
| Specs | [`src/lib/commands/specs.ts`](../src/lib/commands/specs.ts) |
| Handlers | [`src/lib/commands/handlers/`](../src/lib/commands/handlers/) |
| Hook deps | [`src/hooks/commandDeps.ts`](../src/hooks/commandDeps.ts) |

---

## Persistence model

### SQLite via SQL bridge

The DB lives in one file. Production SQL calls go through
`src-tauri/src/sql_bridge.rs`, a small Tauri command bridge over SQLx.
The bridge uses `SqlitePoolOptions::max_connections(1)` on purpose:
transaction sections are multiple JS invokes (`BEGIN`, statements,
`COMMIT`), and a multi-connection SQLite pool can otherwise run the
body on a different connection than the `BEGIN` (#296).

The Rust side is fully async; calls return JS Promises that resolve
after the SQL completes. This is what makes the global JS-side queue
necessary: it prevents top-level operations from interleaving their
statement groups, while the max-1 Rust pool keeps those statements on
one SQLite connection.

### Kysely as the typed query layer

We use [Kysely](https://kysely.dev) as a thin typed query builder
(ADR 007). The decision was: not raw SQL strings (no type safety, easy
to drift from schema), not a full ORM (we don't need lazy loading or
identity maps for a single-user desktop app), but typed query
construction over a hand-written schema.

The schema lives in
[`src/lib/persistence/schema.ts`](../src/lib/persistence/schema.ts).
Adding a column means editing the schema file and the migration; Kysely
type-checks every query at compile time.

The custom Kysely dialect bridges to whatever `SqlImpl` is currently
installed — production SQL bridge, sql.js for tests, or a hand-rolled
mock — so test code goes through the same typed query builder as
production code.

### Repos

Each table family has a repo file under
[`src/lib/persistence/`](../src/lib/persistence/):

- `conversations.ts`, `personas.ts`, `messages.ts`, `flows.ts`, `runs.ts`,
  `settings.ts`.

Repo functions are mostly small and direct. Two conventions matter:

1. **Repo writes that may participate in a `transaction()` take an
   optional `dbi: Kysely<Database>`** that defaults to the global queued
   `db`. When called from inside a transaction body, the caller passes
   `txn.db` (queue-bypassing). Without this, calls inside a transaction
   body would queue and deadlock waiting for the queue head the section
   already holds. Setters that are only ever called outside transactions
   (e.g. simple key/value setters in `settings.ts`, or one-shot writers
   like `setStepIndex` in `flows.ts`) don't need the parameter — but the
   moment one is reached from a transaction body, it must grow the
   parameter or the call site must be restructured.
2. **Narrow setters preferred over broad rewrites.** A setter that
   touches one column does one UPDATE; a setter that touches a junction
   table does the minimum DELETE+INSERT for that junction. Going through
   the full `updateConversation` to flip one boolean was a write
   amplifier — see #275 / #283 for the cleanup.

### RepoContext

[`src/lib/persistence/repoContext.ts`](../src/lib/persistence/repoContext.ts)
is a structural successor to the optional-dbi pattern. Inside a
transaction body, you reach for:

```ts
const repos = reposFor(txn.db);
await repos.messages.appendMessage(args);
await repos.conversations.setCompactionFloor(id, idx);
```

The bundle's methods are pre-bound to the captured `dbi`. The benefit:
forgetting to thread `dbi` becomes a type error (no overload to forget),
and the caller doesn't need to remember which optional argument goes
where.

### Migrations

Migrations are an array of arrays in
[`src/lib/persistence/migrations.ts`](../src/lib/persistence/migrations.ts):

```ts
export const MIGRATIONS: readonly (readonly string[])[] = [
  [`CREATE TABLE conversations (...)`, ...],
  [`ALTER TABLE conversations ADD COLUMN flow_mode INTEGER DEFAULT 0`],
  ...
];
```

Each sub-array is one migration. The runner brackets each entry with
`PRAGMA foreign_keys = OFF / BEGIN IMMEDIATE / statements / PRAGMA
user_version = N / COMMIT / PRAGMA foreign_keys = ON`, all inside one
held section (#281). The user_version PRAGMA is set inside the
transaction so a failed migration rolls back the version too.

A migration that fails triggers `ROLLBACK`, leaves `user_version` at the
prior step, and propagates the error out of `runMigrations` — the app
never finishes startup. A pre-migration backup file is preserved for
manual recovery (#98).

### Where Zod fits

Per [ADR 003](decisions/003-zod-at-trust-boundaries.md), Zod runs at
trust boundaries only:

- File imports (snapshot, persona export).
- Settings reads (each setting key has a Zod schema).
- JSON columns on the conversations table (`autocompact_threshold`,
  `visibility_matrix`, `selected_personas`, `context_warnings_fired`).

Internal types (Conversation, Persona, Message) are NOT re-validated.
They're typed via `schema.ts` and propagated as plain objects through
the codebase. Zod creeping into normal flow code is a rejection on
review.

---

## Transactions and locking rules

This is the section most likely to prevent regressions. **Read it
carefully.** The rules evolved across #267 / #274 / #276 / ADR 011 in
response to actual SQLite-locked bugs.

### The three-tier rule

Every multi-statement DB operation falls into one of three categories.
Picking the right one is essential.

#### Tier 1: `transaction()` — atomic state transitions

Use when **multiple writes must commit atomically (or roll back together).**
Examples:

- Compaction commit (#268): shift indices + insert COMPACTION notice +
  insert per-persona summaries + move the floor. A failure mid-loop must
  leave the DB looking like the operation never happened.
- Snapshot import (#269): create conversation + create personas + insert
  messages + create flow. A failure must not leave a half-formed
  conversation in the sidebar.
- Replay edit (#206 / #267): edit user message + supersede trailing
  assistant rows. Both or neither.

`transaction()` is implemented in
[`src/lib/persistence/transaction.ts`](../src/lib/persistence/transaction.ts).
It wraps `BEGIN IMMEDIATE` ... `COMMIT` (or `ROLLBACK` on throw) inside
a held `withSerializedSection`. The body receives a `TxnContext` with
both a raw `SqlImpl` (for `BEGIN`/`COMMIT` and ad-hoc queries) and a
Kysely instance (`ctx.db`) bound to the raw impl.

Inside the body, **every** repo / use-case call must thread `ctx.db`
or use `reposFor(ctx.db)`. A plain `repo.foo(args)` would route
through the queued global `db` and deadlock waiting on the queue
head the section already holds.

#### Tier 2: `withSerializedSection` — same-webview serialization without atomicity

Use when **multiple statements need to run sequentially without other
ops interleaving, but each can commit independently.** No `BEGIN` /
`COMMIT`; just the queue hold.

Examples:

- `appendMessage` non-transaction path (#276): SELECT MAX(idx) + INSERT
  message + UPDATE conversations.last_message_at. We don't need
  rollback semantics — once the INSERT lands, it's committed; the last_
  message_at bump is a separate observable change. We just need to
  stop a concurrent `transaction()` from sneaking between the SELECT
  and the INSERT.
- `finalizeAssistantMessage` (#282): UPDATE messages + UPDATE conversations.
  last_message_at. Again, two independent commits with no need for
  rollback.
- Per-migration brackets (#281): PRAGMA OFF + BEGIN + statements + COMMIT
  + PRAGMA ON. Each migration is its own atomic unit (the `BEGIN`/`COMMIT`
  inside it provides that), but the surrounding PRAGMAs need the same-
  section guarantee so no external op observes FK = OFF.

`withSerializedSection` is in
[`src/lib/tauri/sql.ts`](../src/lib/tauri/sql.ts). It holds the global
op queue for the duration of the body. Inside the body, the `raw`
SqlImpl bypasses the queue (otherwise the body would deadlock waiting
for the queue head it holds) and has its own per-section async chain
(#274) — so even `Promise.all` over multiple writes inside the body
serializes through the chain.

#### Tier 3: Neither — single sequential repo calls

Use when **the operation is a single repo call, or several
sequential awaited repo calls each of which is independently
acceptable to commit.**

Examples:

- A handful of `appendNotice` calls in a row (each lands one row, order
  doesn't matter to other writers).
- Reading state for the UI (`listMessages`, `getConversation`).
- Writing a single setting via `setSetting`.

These go through the global queue independently. Each is queued in
order, each commits when it gets to the queue head, no atomicity
guarantee across them.

### Things that must NOT live inside any held queue or transaction

- LLM stream calls (seconds to minutes).
- File dialogs (`fs.openDialog`, `fs.saveDialog` — wait for user).
- File reads / writes (typically fast but bounded).
- Keychain reads.

The pattern is: **gather everything outside, then open the transaction
for the writes only.** Compaction and snapshot import both follow this
shape — the LLM phase runs unbounded, the DB commit phase runs inside
one bounded transaction.

### Why not just always use `transaction()`?

Long writer locks. `BEGIN IMMEDIATE` holds the writer lock until
`COMMIT`. If the body takes minutes (because someone slipped an LLM
call in), every other writer in the system blocks for that whole
window. That's why a Tier-2 held section is the right tool when
atomicity isn't actually needed — it serializes without locking out
WAL readers or holding a writer lock past its natural duration.

### Other invariants

- **The `inTransaction` flag in `transaction.ts` is checked at the
  synchronous entry.** This catches actual nested calls AND concurrent
  top-level overlaps; the wording was made honest in #277. Moving the
  guard inside `withSerializedSection` would deadlock real nested
  calls (Codex caught this in review).
- **The single-instance plugin** (#284) prevents two mchat2 processes
  from racing the writer lock at the OS level — without it, a second
  `mchat2.exe` would open the same DB file and bypass every JS-side
  queue.
- **`appendChain` per-conversation FIFO** (in messages.ts) ensures
  multiple async appends on the same conversation hit `MAX(idx)` in
  causal order, before each call's section enforces atomicity.

---

## Personas, visibility, and flows

These three concepts are tightly entangled. Understanding their
relationship is essential before touching the message-context path.

### Personas

A persona is a (provider, model, system-prompt-override) bundle scoped
to one conversation. Each conversation has zero-to-many personas, ordered
by `sort_order` (drag-to-reorder via @dnd-kit; #273).

Persona names are slugified (lowercase, alphanumeric+`-`) for
addressing — `@alice-bot` resolves to the persona named "Alice Bot".
The slug is unique among non-tombstoned personas in the conversation.

Soft deletes are essential: historical assistant messages keep their
`persona_id` foreign key, so deleting a persona can't cascade. The
`name_slug` becomes reusable after delete because the unique constraint
ignores tombstones.

The persona service ([`src/lib/personas/service.ts`](../src/lib/personas/service.ts))
wraps the repo with validation:

- Reserved names rejected (`all`, `everyone`, `system`, `user`, etc. —
  see [`src/lib/providers/derived.ts`](../src/lib/providers/derived.ts)).
- Duplicate slugs rejected.
- Cross-edits propagated: renaming a persona updates every sibling's
  `visibilityDefaults` keyed by the old slug; deleting removes the
  slug from siblings' defaults.

### The selection

Each conversation has a "selection" — the personas that get the next
unaddressed reply. Stored in `conversation_personas_selected`, mirrored
in the conversationsStore.

When a user sends `@bob hi`, only bob replies. When the user sends
just `hi`, every persona in the selection replies (the fan-out
case).

### Visibility matrix

The visibility matrix answers "when persona A talks, who else sees
their replies?" It's a sparse mapping from observer to a list of
sources the observer can see.

Storage is split between two places (transitional):

- **`persona_visibility` table** — slug-keyed for migration robustness
  (renames don't break the relational form). Sparse: only stores rows
  where an observer has at least one hidden source.
- **`conversations.visibility_matrix` JSON column** — id-keyed, dual-
  written for rollback safety. Reads come from the relational form via
  `loadVisibilityMatrixMap`.

The rebuild path
([`src/lib/personas/visibilityRebuild.ts`](../src/lib/personas/visibilityRebuild.ts))
recomputes the matrix from each persona's `visibilityDefaults` (a
slug-keyed map of `'y'` / `'n'`) and writes it through both layers.

PersonaPanel's create/edit/delete flows trigger a rebuild + a
cache-only update (#279) — `applyVisibilityMatrixCache` nudges the
conversationsStore without re-running the full `updateConversation`.

### Flows

A flow is an optional ordered sequence of steps attached to a
conversation. Two step kinds:

- **`personas`** — at this step, send to these personas next.
- **`user`** — at this step, the next user message advances the flow.

The flow has a `current_step_index` and an optional `loop_start_index`
(for repeating sequences). When `flow_mode` is on, the next user
message dispatches per the current step. The runner advances the
cursor on a successful dispatch.

`flow_step_id` is stamped on the run row when a flow advanced the
cursor (#217), so a later edit-replay can rewind the cursor to the
right place (#219).

Identity pin: when a persona is created, an "identity" pin message is
inserted ahead of all subsequent context — "Your name is X" — so the
LLM doesn't default to its provider identity (#36). This is in
[`src/lib/personas/identityPin.ts`](../src/lib/personas/identityPin.ts).

---

## Compaction

Compaction is the project's answer to "long conversations exceed
context windows." It collapses old history into per-persona summary
rows, frees up tokens, and lets the conversation continue.

### Two trigger paths

- **Manual `//compact [N]`** — explicit user command. `N` is the number
  of preserve user messages to keep at the tail.
- **Automatic (autocompact)** — runs after each response if any persona
  crosses its configured threshold (kTokens or % of model max). Set per
  conversation via `//autocompact`.

### Two-phase shape

Compaction splits into LLM phase and DB commit phase, in that order:

1. **LLM phase** ([`runCompaction`](../src/lib/conversations/runCompaction.ts)).
   For each persona, ask its provider to summarize the eligible history
   into a single summary message. Runs unbounded (could take many
   seconds per persona). Outside any transaction.

2. **DB commit phase** ([`runCompactionCommit`](../src/lib/conversations/runCompactionCommit.ts)).
   Inside one transaction, atomically:
   - Shift indices ≥ cutoff up by (1 + N summaries) to open a numbered
     gap.
   - Insert a "COMPACTION" notice at the cutoff.
   - Insert one summary row per persona at cutoff+1..cutoff+N, pinned
     to the corresponding persona.
   - Move the conversation's `compaction_floor_index` to the cutoff.
   The floor is what `buildContext` uses to skip pre-compaction rows
   when building LLM context.

The split was driven by #268. Pre-#268, the DB writes were sequential
queued ops; if any one failed mid-loop, the conversation was left in a
half-compacted state. The split + transaction boundary made the commit
atomic.

### Floor semantics

`compaction_floor_index` is the index BELOW which messages are excluded
from new LLM context — but they stay visible in the UI history.
`buildContext` skips messages with `idx < floor` (except certain pinned
rows like persona identity pins). The COMPACTION notice + the per-
persona summaries sit at the floor and are the visible "wall" between
old and new.

### Narrow floor setter

Pre-#275 the floor move went through the full `updateConversation`,
which DELETE+INSERTed three junction tables for one integer. Now we
have `setCompactionFloor` (a single UPDATE) and the duplicate
post-runCompaction call from `compaction.ts` was removed in favor of
`reloadConversations()` to refresh the cache. See #275.

---

## State management and cache invalidation

The webview has two cache layers, and confusing them is a common
source of subtle bugs.

### Layer 1: Zustand stores

Each store under `src/stores/` owns a slice of UI state and a small
cache:

- **`conversationsStore`** — current conversation id, "loaded" flag,
  conversation list (cached via repo-query), action API for
  conversation mutations.
- **`messagesStore`** — current conversation's messages, supersededIds
  set, in-flight stream IDs.
- **`personasStore`** — current conversation's personas, current
  selection.
- **`sendStore`** — per-target stream status, registered streams.
- **`uiStore`** — modal open/closed, dev settings, etc.

Stores hold reactive state that drives React renders. They're written
to by **store actions** that:

1. Persist to disk via the relevant repo.
2. Update the cache to reflect the new state.

```ts
async setFlowMode(id, on) {
  const current = cacheGet().find((c) => c.id === id);
  if (!current) return;
  await repo.setConversationFlowMode(id, on);  // disk
  cacheUpdate(replaceById({ ...current, flowMode: on }));  // cache
},
```

### Layer 2: repo-query cache

[`src/lib/data/useRepoQuery.ts`](../src/lib/data/useRepoQuery.ts) is a
React-Query–style cache for read queries (`["conversations"]`,
`["personas", convId]`, `["flow", convId]`). Components subscribe with
`useRepoQuery(["personas", id], () => personasRepo.listPersonas(id))`
and re-render when the cache invalidates.

The repo-query cache and the Zustand store caches sometimes overlap —
which is fine, but mutations need to update the right one(s):

- `invalidateRepoQuery(["personas"])` — bumps the query cache; next
  read re-fetches.
- `getRepoQueryCache().set(...)` — sets a value optimistically.
- `useConversationsStore.getState().applyVisibilityMatrixCache(id, m)` —
  the narrow cache-only setter pattern (#279).

### Cache update patterns

- **Optimistic UI update** — set the cache before the persistent write
  completes (e.g. drag-to-reorder personas, #273). On failure, the cache
  needs to roll back.
- **Persist-then-update** — most store actions. Disk first, cache after.
- **Cache-only patch** — when something *else* already wrote to disk
  (e.g. `rebuildVisibilityFromPersonaDefaults` already persisted), only
  the cache needs nudging. Use a narrow `applyXxxCache` setter, never
  the full `updateConversation` path.
- **Reload** — after a DB-heavy operation that mutated several tables,
  call `deps.reloadConversations()` / `reloadMessages(id)` /
  `loadPersonas(id)` to re-pull fresh state.

### Why the dual cache exists

Zustand stores predate the repo-query cache (which was added later for
list-shaped queries). Migration is incremental. Some state is in both
places transitionally; the conversationsStore has a synchronous
`conversationsList()` accessor that reads from the repo-query cache so
non-React callers (orchestration, deps factories) don't have to plug
into React.

### Background tasks

[`src/lib/observability/backgroundTask.ts`](../src/lib/observability/backgroundTask.ts)
is the helper for fire-and-forget DB writes. Use it whenever a side-
effect would otherwise be `void someAsyncCall()`:

```ts
backgroundTask("PersonaPanel.rebuildVisibilityAfterCreate", async () => {
  const matrix = await rebuildVisibilityFromPersonaDefaults(conversation.id);
  useConversationsStore.getState().applyVisibilityMatrixCache(conversation.id, matrix);
});
```

Failures are logged to the structured log via `crashLog.appendStructured`.
The pattern is more observable than `void`, less ceremonious than full
error propagation, and exists specifically because silent failures from
fire-and-forget writes were a recurring debugging headache (#270, #279).

---

## Testing architecture

Three test layers, with very different setup costs:

### Vitest unit tests (`tests/unit/`)

The dominant suite — ~190 test files. Run via `npm test`.

The test seam that makes most of these work is
[`src/lib/testing/createTestDb.ts`](../src/lib/testing/createTestDb.ts):

```ts
const handle = await createTestDb();
// `handle.impl` is a sql.js-backed in-memory SqlImpl,
// installed via __setImpl(handle.impl) in lib/tauri/sql.ts.
// All migrations have been applied. The schema matches production.
// ...
handle.restore();  // back to the previous impl
```

This means:

- Tests run against the same Kysely typed query layer as production.
- The `sql.js` adapter is API-compatible with the production SQL bridge for our
  purposes, so persistence tests are real round-trips, not mocks.
- Each test gets a fresh schema-up-to-date DB.

For tests that need to seed state at an intermediate migration version
(e.g. testing migration N+1):

```ts
const handle = await createTestDb({ stopAt: N });
// Seed legacy data here.
await handle.runRemainingMigrations();
// Verify the new state.
```

### Mock impls

For tests pinning queue / section / transaction behavior, you can wrap
the impl:

```ts
const counts = new Map<string, number>();
const wrapped: SqlImpl = {
  execute: async (q, p) => {
    if (/^\s*UPDATE/i.test(q)) {
      const table = q.match(/UPDATE\s+["`]?(\w+)/i)![1]!.toLowerCase();
      counts.set(table, (counts.get(table) ?? 0) + 1);
    }
    return target.execute(q, p);
  },
  // ...
};
__setImpl(wrapped);
```

This is how the count-writes tests for `setCompactionFloor` (#275) and
`finalizeAssistantMessage` (#282) work — they pin contracts about how
many statements a high-level call issues.

### Hand-rolled stub deps

Use cases under `src/lib/app/` take `*Deps` parameters by design (ADR
005), so testing them is cheap:

```ts
const deps: SendMessageDeps = {
  getPersonas: () => [],
  appendUserMessage: vi.fn(),
  // ... only the deps your test actually uses
};
await sendMessage(deps, { conversation, text: "hi" });
```

No React, no Zustand, no DB if you don't need one. The `*Deps`
interfaces are intentionally narrow so test scaffolding stays light.

### Playwright e2e (`tests/e2e/`)

Run via `npm run test:e2e`. Boots a real Tauri app pointed at the
mock provider (`src/lib/providers/mock.ts`). Slow, brittle, but it's
the only way to exercise the full Tauri shell + SQL bridge path.

Use sparingly — mostly for smoke tests of the UI (composer, sidebar,
persona panel) and end-to-end flows where the unit-test scaffolding
would be more cumbersome than the Playwright run.

### Naming conventions

- Test files mirror the source tree: `tests/unit/lib/foo.ts` tests
  `src/lib/foo.ts`.
- Issue-pinning tests reference the issue in a comment block at the top
  of the file or in a `describe()` title. Useful for cross-referencing
  when reading git log.
- Regression tests go next to the code they pin, not in a separate
  "regressions" tree.

---

## Architectural invariants

A flat list of the rules new contributors are most likely to break.
Each links to the ADR or issue that anchors it.

### Persistence

- **All `@tauri-apps/*` imports go through `src/lib/tauri/`.** Enforced
  by ESLint per [ADR 001](decisions/001-lib-app-boundary.md).
- **Every repo function takes optional `dbi: Kysely<Database>`.**
  Defaults to the global queued `db`. Inside a `transaction()` body,
  callers thread `txn.db` (via `reposFor(txn.db)`). See
  [ADR 011](decisions/011-section-token-transactions.md).
- **Use the three-tier rule for multi-statement writes** — see
  [Transactions and locking rules](#transactions-and-locking-rules).
- **Prefer narrow setters over broad `updateConversation`-style writes.**
  Narrow setters touch one column; broad rewrites touch every column +
  three junction tables. See #275 / #283.
- **Dual-write legacy JSON columns** while the relational form is the
  read path. Drop the dual-write only via an explicit migration.

### Use cases and dependencies

- **`src/lib/` may not import from `src/stores/*` or `src/hooks/*`.**
  Cross-layer state goes through deps. Enforced by ESLint per
  [ADR 001](decisions/001-lib-app-boundary.md).
- **Use cases in `src/lib/app/` take `*Deps` parameters; never reach
  into Zustand directly.** See
  [ADR 005](decisions/005-dep-inversion-in-lib-app.md).
- **`*Deps` interfaces are narrow.** Each use case picks only the slices
  it needs from `deps.ts`. Adding a getter to a deps shape is fine; the
  cost is one stub field in test setup, not a cascade.

### Streaming and orchestration

- **LLM streams run outside any transaction.** The pattern is "gather
  outside, commit inside."
- **The runOneTarget / runPlannedSend layer fans out to N personas in
  parallel.** Each independent stream pumps tokens into its placeholder.
- **Per-stream finalization is one `finalizeAssistantMessage` call**
  (#282), not the legacy 4-6 separate UPDATEs.

### Validation

- **Zod runs at trust boundaries only.** File imports, settings reads,
  JSON columns. NOT internal types. See
  [ADR 003](decisions/003-zod-at-trust-boundaries.md).

### State and cache

- **Don't chain a persistent setter that re-writes state already on
  disk.** The PersonaPanel visibility-rebuild path (#279) was doing
  this; the fix was a cache-only `applyVisibilityMatrixCache` setter.
- **Background tasks go through `backgroundTask(label, fn)`.** Bare
  `void asyncCall()` swallows errors silently. See #270 / #279.

### Process and packaging

- **Single-instance plugin must be registered FIRST in the Tauri
  builder chain.** A second mchat2 invocation hands its args to the
  running process and exits before the SQL bridge opens the DB file.
  See #284.
- **Issue numbers drive version bumps.** Don't hand-edit version
  strings. Use `npm run bump -- -m "chore: bump version for #NNN"`.

---

## Where to dig deeper

- Specific decision rationale → [docs/decisions/](decisions/) and the
  recommended reading order in
  [docs/decisions/README.md](decisions/README.md).
- Workflow and process → [docs/CONTRIBUTING.md](CONTRIBUTING.md).
- Specific concrete failures → [docs/troubleshooting.md](troubleshooting.md).
- "How do I add a slash command / migration / repo method / provider"
  → [docs/recipes.md](recipes.md).
- Module-specific notes → README files in subdirectories. Currently:
  [`src/lib/app/README.md`](../src/lib/app/README.md). Others may exist;
  `find src -name README.md` will list them.
- Historical context → `git log` and `gh issue list`. Most code paths
  trace back to a numbered issue.
