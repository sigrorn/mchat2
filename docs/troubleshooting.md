# Troubleshooting

Symptoms → diagnostic steps → fix patterns. Open this when something is
broken; it's reference material, not a tutorial.

For the mental model behind these failure modes, see
[ARCHITECTURE.md](ARCHITECTURE.md), especially
[Transactions and locking rules](ARCHITECTURE.md#transactions-and-locking-rules).

---

## Database / SQLite

### `(code: 5) database is locked`

**Symptom.** A `tauri-plugin-sql` call rejects with `code: 5 database is
locked`. Often surfaces during `//pop`, `//compact`, persona reorder, or
under heavy multi-persona send load.

**Mental model.** SQLite's WAL mode allows one writer + many readers. The
writer lock is held by whichever connection currently has `BEGIN
IMMEDIATE`. `tauri-plugin-sql` is backed by `sqlx::SqlitePool` with
multiple connections; if two connections each issue a write, they race
the writer lock.

The project's defenses, layered:

1. The **global JS op queue** in
   [`src/lib/tauri/sql.ts`](../src/lib/tauri/sql.ts) serializes every
   `sql.execute` / `sql.select`. With one queue, sqlx tends to return the
   most-recently-released connection, so the JS-side becomes effectively
   single-connection.
2. **`withSerializedSection` / `transaction()`** hold the queue across a
   group of statements (see ADR 011).
3. **Per-section internal chain** (#274) makes the section's raw impl
   serialize statements internally, so `Promise.all` over multiple writes
   inside one section stays single-flight.
4. **Single-instance plugin** (#284) prevents a second mchat2 process from
   opening the same DB file.

**Diagnostic steps.**

1. **What was happening when it fired?** Check the structured log
   ([`src/lib/observability/crashLog.ts`](../src/lib/observability/crashLog.ts))
   and any nearby `backgroundTask` failures. The log entry includes a
   label that names the call site.
2. **Was the failing call inside a `transaction()` body?** If yes, every
   internal call in that body must accept and use the transaction's
   `dbi` (or `txn.db` via `reposFor(txn.db)`). A plain `await
   repo.foo(args)` queues globally and deadlocks waiting on the section
   that holds the queue head.
3. **Was the call from inside a section body firing `Promise.all`?**
   Pre-#274 this was the v2.73.2 reorderPersonas bug (parallel writes
   through different sqlx connections, each racing `BEGIN IMMEDIATE`).
   Post-#274 the section's chain serializes these — but if you're seeing
   it again, check whether the call site is using the section's `raw`
   impl or has reached for the global `sql` somehow.
4. **Did a second mchat2 process get launched?** The single-instance
   plugin should prevent this; if you see two processes (`tasklist`,
   `ps`), the plugin failed to register. Re-check `src-tauri/src/lib.rs`.

**Fix patterns.**

- **Caller in a transaction body:** thread `txn.db` (or use `reposFor(txn.db)`)
  through every repo / service call. Every persistence repo function takes
  an optional `dbi: Kysely<Database>`.
- **Caller outside a transaction:** confirm the failing call uses the
  global `sql` queue (not a stashed `raw` impl from somewhere).
- **Genuinely concurrent top-level transactions:** the second one will
  throw `transaction(): another transaction is already running…`
  (#277 made the wording honest). The fix is at the UX layer — disable
  the submit button while a transaction is in flight, or queue user
  input until the prior transaction releases.

---

### `transaction(): another transaction is already running`

**Symptom.** A `transaction()` call rejects with that message.

**Cause.** The `inTransaction` guard at the synchronous entry of
`transaction()` ([`src/lib/persistence/transaction.ts`](../src/lib/persistence/transaction.ts))
fired. Two possible reasons, indistinguishable from the message alone
(per the wording fix in #277):

- **Actual nested call** — code inside one transaction body called
  `transaction()` again. Refactor the inner caller to run outside its
  own transaction, or pass `dbi` through so the inner work joins the
  outer.
- **Concurrent top-level overlap** — two unrelated user actions both
  fired `transaction()` and the second one's sync-entry check saw the
  first still in flight. The guard intentionally throws here rather
  than queue, because moving the guard inside `withSerializedSection`
  would deadlock real nested calls.

**Diagnostic steps.**

1. Check the call stack of the throwing call. Is it inside a
   `transaction(async (txn) => …)` body? → actual nesting; the inner
   caller needs to be refactored.
2. Otherwise → concurrent overlap. The action will succeed if retried.

**Fix patterns.**

- For nesting bugs: thread `dbi` through, run the inner work via
  `reposFor(txn.db).foo.bar(...)` instead of `repo.bar(...)`.
- For overlap: retry the failed action. If the overlap is reproducible
  in the UI (e.g. drag-end fires while `//pop` is mid-body), file an
  issue to add a single-flight gate at the UX layer.

---

### `UNIQUE constraint failed: messages.conversation_id, messages.idx`

**Symptom.** An `appendMessage` or `insertMessageAtIndex` rejects with a
unique constraint violation on the message index.

**Cause.** Two writers raced the `MAX(idx) + 1` allocation. Pre-#276 this
could happen if a `transaction()` body fired between an `appendMessage`'s
SELECT and INSERT. Post-#276 the non-transaction path holds a section
across all three statements (SELECT MAX, INSERT, UPDATE
last_message_at).

**Diagnostic steps.**

1. Find the call site. Is it `appendMessage` or `insertMessageAtIndex`?
2. If `appendMessage`: is the caller inside a transaction? The transaction
   path doesn't get the held section (the caller's transaction is the
   atomicity boundary). Check that the caller threads `txn.db`.
3. If `insertMessageAtIndex`: this writes at a caller-supplied idx.
   Confirm the caller has reserved the slot via `shiftMessageIndicesFrom`
   or computed the idx after the most recent prior write inside the same
   transaction.

**Fix patterns.**

- Bulk inserts: use `bulkAppendMessages` (#278) which computes idx once
  at the start and chunks INSERTs.
- Custom multi-row inserts: wrap in `transaction()` and pass `txn.db`
  through every repo call.

---

## Streaming / providers

### Stream completes but the bubble shows no content

**Symptom.** The assistant bubble appears, the stream completes (the
status indicator clears), but the bubble body is empty.

**Cause.** `streamRunner` treats this as a silent failure (#26/#27) — no
tokens, no usage, no explicit error. The likely cause is the provider
adapter parsing succeeded but yielded nothing (e.g. an SSE event with no
`content` field for that role).

**Diagnostic steps.**

1. **Enable tracing** in the UI (Settings → Tracing → enable). This
   writes per-conversation trace files that capture the raw SSE.
2. Reproduce the empty stream and inspect the trace's `inbound` rows.
3. If the trace shows tokens that didn't reach the bubble, the bug is in
   the adapter's parser (look in `src/lib/providers/<provider>.ts`).
4. If the trace shows a 4xx/5xx HTTP response, the bug is upstream of
   `streamRunner` — the request hit the API but was rejected.

**Fix patterns.**

- Adapter parser bug: write a unit test in
  `tests/unit/providers/<provider>.test.ts` that feeds the recorded SSE
  and asserts the expected tokens reach the runner.
- Upstream rejection: surface a real error message instead of letting it
  fall through to the silent path. The streamRunner's "produced no
  response" branch should rarely fire in production.

### `provider produced no response (no tokens, no usage, no error)`

**Symptom.** The bubble shows that exact red error.

**Cause.** Same as above — the stream completed with no tokens and no
explicit error. This is the diagnostic message for the silent-failure
case.

**Diagnostic steps.** Same as "Stream completes but the bubble shows no
content."

---

### Provider returns 401 / 403 / "invalid api key"

**Symptom.** A send fails immediately with an authentication error in
the bubble.

**Diagnostic steps.**

1. Confirm the key is set in the right keychain slot. Each provider has
   its own slot:
   - `anthropic_api_key`
   - `openai_api_key`
   - `gemini_api_key`
   - `openai_compat_<preset>_api_key` (per OpenAI-compatible preset)
2. The key is read via the keychain bridge in
   [`src-tauri/src/keychain.rs`](../src-tauri/src/keychain.rs). On
   Linux, the Secret Service daemon must be running (gnome-keyring or
   KWallet).

**Fix patterns.**

- Re-enter the key via Settings.
- For OpenAI-compatible presets: the key slot is preset-keyed, so a key
  entered for "Infomaniak" is not visible to "Apertus" (now folded into
  Infomaniak per ADR 010).

---

## State / cache

### Sidebar shows a phantom unread dot that won't clear

**Symptom.** The sidebar's red unread dot stays on a conversation even
after you've opened it.

**Mental model.** The unread dot is computed from
`conversation.last_message_at > conversation.last_seen_at`. `last_seen_at`
is stamped when ChatView's effect fires (on conversation activation and on
departure — see #250).

**Diagnostic steps.**

1. Check the conversation row in the DB:
   ```sql
   SELECT id, title, last_seen_at, last_message_at FROM conversations WHERE id = ?;
   ```
2. If `last_message_at > last_seen_at` after activation, the markSeen
   stamp didn't fire or didn't land.
3. Check the structured log for `ChatView.markSeen.activate` /
   `ChatView.markSeen.depart` `backgroundTask` failures.

**Fix patterns.**

- Reload the conversation list (`useConversationsStore.getState().load()`)
  to re-sync the cache from disk if a prior write didn't propagate.
- Investigate the backgroundTask failure if there's a logged error.

---

### Persona panel shows stale visibility matrix after edit

**Symptom.** Edited a persona's visibility defaults; the matrix panel
hasn't updated.

**Mental model.** The visibility rebuild path
([`src/lib/personas/visibilityRebuild.ts`](../src/lib/personas/visibilityRebuild.ts))
writes both the `persona_visibility` table and the legacy
`conversations.visibility_matrix` JSON column on disk, then the caller
needs to nudge the conversations cache so the matrix-panel re-renders.

Pre-#279 the cache nudge went through the full
`updateConversation`, which re-DELETE+INSERTed three junction tables for
no reason. Post-#279 PersonaPanel uses
`applyVisibilityMatrixCache(id, matrix)` — a cache-only update (the DB
write already happened in `rebuildVisibilityFromPersonaDefaults`).

**Diagnostic steps.**

1. Confirm the rebuild ran (check that `persona_visibility` rows match
   the new defaults).
2. Confirm the cache nudge ran — the conversations-store cache should
   have the new `visibilityMatrix` value.

**Fix patterns.**

- Manual workaround: switch away from the conversation and back — the
  re-activation reload will pull fresh state.
- Bug fix: investigate the call site's `applyVisibilityMatrixCache` call
  for the corresponding conversation id.

---

## Migrations

### App refuses to start after a migration commit

**Symptom.** App launches, blank screen, console shows a SQL error.

**Mental model.** Migrations run on app start via `runMigrations` in
[`src/lib/persistence/migrations.ts`](../src/lib/persistence/migrations.ts).
Each migration is wrapped in its own held section + `BEGIN IMMEDIATE`
+ `PRAGMA foreign_keys` bracket (#281). A failing migration triggers
`ROLLBACK` and propagates the error out of `runMigrations` — the app
never finishes startup.

**Diagnostic steps.**

1. Check `runMigrations` errors in the console / structured log.
2. The migration that failed is the one whose `user_version` would have
   been set; the prior version stays committed.
3. The pre-migration backup file (`mchat2.db.backup-<N>`) is preserved
   on failure for debugging (see #98). Look in the app-data dir.

**Fix patterns.**

- Restore from the backup if the migration corrupted data:
  `cp mchat2.db.backup-<N> mchat2.db`.
- Fix the migration SQL, bump the migration index, and ship a new
  release.
- Migration tests under `tests/unit/persistence/migrationV*.test.ts`
  should catch most issues before commit.

---

## Build / packaging

### `cargo check` fails with a missing plugin error

**Symptom.** `cargo check --manifest-path src-tauri/Cargo.toml` fails
saying a `tauri-plugin-*` crate isn't found.

**Cause.** A new plugin was added to `Cargo.toml` but `cargo` hasn't
fetched it yet, or the version doesn't match a published one.

**Fix patterns.**

- `cargo update --manifest-path src-tauri/Cargo.toml` to refresh the
  lock file.
- Confirm the version in `Cargo.toml` exists in the registry.
- For workspace-internal crates that aren't published, use a `path =`
  dependency.

---

### Type errors after a kysely / schema change

**Symptom.** `npx tsc --noEmit` reports type errors after editing
`src/lib/persistence/schema.ts`.

**Mental model.** The schema file is hand-written; Kysely uses it to
type every query at compile time. Adding a column means the column
appears in every `SELECT *` result and as a required field in every
`INSERT INTO X .values({…})` value object.

**Fix patterns.**

- New columns with a default: declare the type as `T | null` (or with
  the default's type) and add the migration that creates the column.
- Existing columns becoming optional: declare `T | null`, run the
  migration that allows NULL, update writers to pass `null` where
  appropriate.
- Removing columns: write the DROP migration, remove the field from
  schema.ts, fix every callsite the typechecker flags.

---

## Where errors should surface in the UI

For reference when adding new features, the project has consistent
error-display conventions:

- **Send-time provider errors** → in the assistant bubble itself, with
  red "error: <message>" text and a Retry button (when applicable).
- **Slash-command errors** → as `notice` rows in the chat (via
  `appendNotice`), prefixed with the command name.
- **Settings/key validation errors** → inline in the settings panel.
- **Catastrophic startup failures** (DB corruption, migration error)
  → console + structured log; the app stays in its blank-screen state
  rather than presenting a partially-loaded UI.

Background-task failures (`backgroundTask(label, fn)`) are logged to
the structured log but not surfaced in the UI by design — they're for
operations the user shouldn't have to think about.
