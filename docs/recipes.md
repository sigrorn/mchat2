# Recipes

Step-by-step instructions for the most common kinds of change. Each recipe
links to existing examples in the codebase so you can read working code
alongside the steps.

For the architectural background, read
[ARCHITECTURE.md](ARCHITECTURE.md) first.

---

## Add a slash command

A slash command (`//foo bar`) is dispatched through
[`src/lib/commands/dispatch.ts`](../src/lib/commands/dispatch.ts) to a
handler under `src/lib/commands/handlers/`. Each handler takes a
`CommandContext` (which includes `deps: CommandDeps`) and returns a
`CommandResult` or `void`.

### Steps

1. **Define the command spec** in
   [`src/lib/commands/specs.ts`](../src/lib/commands/specs.ts). The spec
   declares the command name, parameter shape (parsed via Zod), and
   optional help text.

2. **Add a handler** under `src/lib/commands/handlers/`. Pattern:

   ```ts
   // src/lib/commands/handlers/myCommand.ts
   import type { CommandContext, CommandResult } from "./types";

   export async function handleMyCommand(
     ctx: CommandContext,
     payload: { someArg: string },
   ): Promise<CommandResult | void> {
     const { conversation } = ctx;
     // Use ctx.deps.<thing> for everything — no direct store imports.
     await ctx.deps.appendNotice(conversation.id, `did the thing`);
   }
   ```

3. **Wire the handler into the dispatcher** in
   [`src/lib/commands/dispatch.ts`](../src/lib/commands/dispatch.ts) —
   add a case for the new spec name.

4. **Extend `CommandDeps`** in
   [`src/lib/app/deps.ts`](../src/lib/app/deps.ts) if your handler needs
   a new store action. Add a narrow `Pick<XxxWriteDeps, "newAction">` to
   the composed type.

5. **Wire the new dep** in
   [`src/hooks/commandDeps.ts`](../src/hooks/commandDeps.ts) — connect
   the dep's signature to the matching `useXxxStore.getState().…` call.

6. **Add a unit test** under `tests/unit/commands/<name>Handler.test.ts`.
   Pass a hand-rolled stub `CommandDeps` so the test doesn't need
   stores.

7. **Add help text** if the command should be discoverable: edit
   [`src/lib/commands/help.ts`](../src/lib/commands/help.ts).

### Working examples to read

- [`src/lib/commands/handlers/compaction.ts`](../src/lib/commands/handlers/compaction.ts)
  — `//compact`. Shows a handler that orchestrates a heavy DB-touching
  use case (`runCompaction`).
- [`src/lib/commands/handlers/history.ts`](../src/lib/commands/handlers/history.ts)
  — `//pop`. Shows a handler that does a multi-step DB write inside a
  `transaction()`.
- [`src/lib/commands/handlers/visibility.ts`](../src/lib/commands/handlers/visibility.ts)
  — `//visibility`. Shows a handler that reads + writes the visibility
  matrix.

---

## Add a repo method

"Repo method" = a function under `src/lib/persistence/<X>.ts` that issues
a SQL query via the typed Kysely instance.

### Convention

Repo writes that may participate in a `transaction()` take an **optional**
`dbi: Kysely<Database>` parameter that defaults to the global `db` (the
queued one). When called from inside a transaction body, the caller passes
`txn.db` (or uses `reposFor(txn.db).<repo>.<method>(args)` from
[`src/lib/persistence/repoContext.ts`](../src/lib/persistence/repoContext.ts)).

This is the [optional-dbi pattern](decisions/011-section-token-transactions.md)
from ADR 011. Setters that are only ever called outside transactions
(simple key/value setters, one-shot writers) can skip the parameter.
**If you're unsure whether your new function will end up inside a
transaction, add the parameter** — it's cheap, and adding it later
requires changing every call site.

### Steps

1. **Add the function** in `src/lib/persistence/<repo>.ts`:

   ```ts
   export async function setSomething(
     id: string,
     value: string,
     dbi: Kysely<Database> = db,
   ): Promise<void> {
     await dbi
       .updateTable("table_name")
       .set({ column_name: value })
       .where("id", "=", id)
       .execute();
   }
   ```

2. **Add it to RepoContext** in
   [`src/lib/persistence/repoContext.ts`](../src/lib/persistence/repoContext.ts)
   so transaction bodies can reach it via `reposFor(txn.db)`:

   ```ts
   export interface SomeRepoCtx {
     setSomething: (
       id: Parameters<typeof someRepo.setSomething>[0],
       value: Parameters<typeof someRepo.setSomething>[1],
     ) => ReturnType<typeof someRepo.setSomething>;
     // …
   }

   // In reposFor:
   {
     setSomething: (id, value) => someRepo.setSomething(id, value, dbi),
   }
   ```

3. **Add a unit test** under
   `tests/unit/persistence/<repo>.test.ts`. Use `createTestDb()` to spin
   up a sql.js-backed in-memory DB.

4. **Spy on the impl** if you're pinning a write-count contract — see
   the count-writes pattern in
   [`tests/unit/persistence/narrowConversationSetters.test.ts`](../tests/unit/persistence/narrowConversationSetters.test.ts).

### Working examples to read

- [`src/lib/persistence/conversations.ts`](../src/lib/persistence/conversations.ts)
  — narrow setters added in #275 (`setCompactionFloor`) and #283
  (`setConversationTitle` / `DisplayMode` / `FlowMode` / `Autocompact`).
  Each is a single-column UPDATE.
- [`src/lib/persistence/messages.ts`](../src/lib/persistence/messages.ts)
  — `bulkAppendMessages` (#278) shows the bulk-INSERT-with-chunking
  pattern; `finalizeAssistantMessage` (#282) shows how to fold multiple
  legacy setters into one.

---

## Add a migration

Migrations live in
[`src/lib/persistence/migrations.ts`](../src/lib/persistence/migrations.ts)
as an array of arrays — each sub-array is one migration's statements.
The DB's `user_version` PRAGMA tracks how many have been applied.

### Steps

1. **Append the new migration** to `MIGRATIONS` in
   `src/lib/persistence/migrations.ts`:

   ```ts
   export const MIGRATIONS: readonly (readonly string[])[] = [
     // existing migrations…
     [
       `ALTER TABLE conversations ADD COLUMN new_field TEXT`,
       `CREATE INDEX idx_conversations_new_field ON conversations(new_field)`,
     ],
   ];
   ```

   The migration runner brackets each entry with `PRAGMA foreign_keys =
   OFF` / `BEGIN IMMEDIATE` / statements / `PRAGMA user_version = N` /
   `COMMIT` / `PRAGMA foreign_keys = ON`, all inside one held section
   (#281). Don't include any of those PRAGMAs / BEGIN / COMMIT in your
   migration SQL.

2. **Update the schema type** in
   [`src/lib/persistence/schema.ts`](../src/lib/persistence/schema.ts)
   to add the new column to the relevant table interface.

3. **Update the row → object converter** (e.g. `rowToConversation`) and
   the object → row converter (e.g. `conversationToRow`) in the matching
   repo file.

4. **Add a migration test** under
   `tests/unit/persistence/migrationV<N>.test.ts`. Use
   `createTestDb({ stopAt: N - 1 })` to seed legacy data at the prior
   version, then call `handle.runRemainingMigrations()` to apply the
   migration under test.

5. **Bump the schema column count** in any test that asserts the
   column count of a table (rare, but
   `tests/unit/testing/createTestDb.test.ts` has one).

### Working examples to read

- Migration #21 (added `flow_mode`):
  - The migration SQL in `migrations.ts` (search for "flow_mode").
  - The test in [`tests/unit/persistence/migrationV21.test.ts`](../tests/unit/persistence/migrationV21.test.ts).
- Migration #29 (cost backfill — interesting because it computes values
  from the PRICING table at migration time):
  - [`tests/unit/persistence/migrationV29.test.ts`](../tests/unit/persistence/migrationV29.test.ts).

### Things to be careful about

- **Foreign keys are OFF inside each migration** — necessary for table
  rebuilds (DROP+RENAME) but means dangling FKs won't be caught during
  the migration. Validate manually if your migration creates rows.
- **Idempotency.** Migrations run exactly once each (per `user_version`
  bookkeeping), but if you ship a buggy migration and need to fix it,
  the fix has to be a *new* migration (you can't edit a shipped one
  without breaking users mid-upgrade).

---

## Add a provider

A "provider" is one entry in
[`src/lib/providers/registry.ts`](../src/lib/providers/registry.ts) plus
an adapter file under `src/lib/providers/<name>.ts` that implements the
`ProviderAdapter` interface from
[`src/lib/providers/adapter.ts`](../src/lib/providers/adapter.ts).

### Steps

1. **Implement the adapter** under `src/lib/providers/<name>.ts`:

   ```ts
   import type { ProviderAdapter } from "./adapter";

   export const myProviderAdapter: ProviderAdapter = {
     stream: async (input, signal) => {
       // Make the streaming HTTP call via lib/tauri/http.ts.
       // Yield ProviderStreamEvent values: token, usage, error.
     },
     // …
   };
   ```

2. **Register it** in
   [`src/lib/providers/registry.ts`](../src/lib/providers/registry.ts):

   ```ts
   export const PROVIDER_REGISTRY = {
     // existing entries…
     my_provider: {
       displayName: "My Provider",
       defaultModel: "my-default-model",
       requiresKey: true,
       keychainKey: "my_provider_api_key",
       // …
     },
   } satisfies Record<ProviderId, ProviderMeta>;
   ```

3. **Add the provider id** to the `ProviderId` type union in
   [`src/lib/types/providers.ts`](../src/lib/types/providers.ts)
   (re-exported from `src/lib/types/index.ts`).

4. **Add a pricing entry** in
   [`src/lib/pricing/table.ts`](../src/lib/pricing/table.ts) if the
   provider's models have public pricing — this drives cost tracking
   in `//stats` and the spend table. Models without an entry render
   as "?" in the spend table by design.

5. **Add the adapter to the registry of adapters** in
   [`src/lib/providers/registryOfAdapters.ts`](../src/lib/providers/registryOfAdapters.ts).

6. **Add tests** under `tests/unit/providers/<name>.test.ts`. Feed
   recorded SSE through the adapter and assert the yielded events
   match.

### Considerations

- For an OpenAI-compatible API, **don't add a new provider** — extend
  the `openai_compat` meta-provider with a new preset instead. See
  [ADR 004](decisions/004-openai-compat-meta-provider.md) and the
  preset config in
  [`src/lib/providers/openaiCompatPresets.ts`](../src/lib/providers/openaiCompatPresets.ts).
- For a non-streaming API, the adapter still yields one final event
  with the whole response — but you lose live token-by-token UI
  feedback.

### Working examples to read

- [`src/lib/providers/anthropic.ts`](../src/lib/providers/anthropic.ts)
  — straightforward streaming adapter.
- [`src/lib/providers/openaiCompat.ts`](../src/lib/providers/openaiCompat.ts)
  — the meta-provider; one adapter handles N OpenAI-shaped backends.
- [`src/lib/providers/mock.ts`](../src/lib/providers/mock.ts) — used by
  tests; deterministic streaming output.

---

## Add a setting

Settings live in the `settings` table. Reads go through
[`src/lib/persistence/settings.ts`](../src/lib/persistence/settings.ts);
keys are declared in
[`src/lib/settings/keys.ts`](../src/lib/settings/keys.ts).

### Steps

1. **Add a key** in
   [`src/lib/settings/keys.ts`](../src/lib/settings/keys.ts):

   ```ts
   export const MY_NEW_SETTING_KEY = "my_new_setting";
   ```

2. **Read the setting** at the call site:

   ```ts
   import { getSetting } from "@/lib/persistence/settings";
   const value = await getSetting(MY_NEW_SETTING_KEY);
   ```

   `getSetting` returns `string | null` and parses with Zod if you
   provide a schema (recommended — settings are a Zod trust boundary
   per [ADR 003](decisions/003-zod-at-trust-boundaries.md)).

3. **Wire it into the use case via deps** if a `lib/app/` use case
   needs it — add a `Pick<SettingsReadDeps, "getX">` to the relevant
   `*Deps` shape (see
   [`src/lib/app/deps.ts`](../src/lib/app/deps.ts)).

4. **Add a UI control** in the settings dialog. The settings UI is split
   across
   [`src/components/SettingsDialog.tsx`](../src/components/SettingsDialog.tsx)
   (the shell),
   [`src/components/SettingsGeneralDialog.tsx`](../src/components/SettingsGeneralDialog.tsx)
   (general tab), and
   [`src/components/SettingsOpenaiCompatTab.tsx`](../src/components/SettingsOpenaiCompatTab.tsx)
   (presets tab). Pick the one whose tab the new control belongs in, or
   add a new tab via `SettingsDialog.tsx`.

5. **Migration** is only needed if the setting is structurally new
   (the `settings` table itself already exists and accepts arbitrary
   `(key, value)` rows).

### Working examples to read

- `GLOBAL_SYSTEM_PROMPT_KEY` is a fully-wired example — search the
  codebase for it.

---

## Add an import/export field

Snapshots and persona exports are JSON envelopes versioned with a
`version` integer. Adding a new field means deciding what the importer
should do for legacy snapshots that don't have it.

### Steps

1. **Update the schema** in
   [`src/lib/conversations/snapshot.ts`](../src/lib/conversations/snapshot.ts)
   (or the persona-export equivalent under
   `src/lib/personas/importExport.ts`). Add the new field with an
   optional Zod modifier so legacy snapshots still parse:

   ```ts
   newField: z.string().nullable().optional(),
   ```

2. **Update the export side** to write the field:

   ```ts
   newField: conversation.newField,
   ```

3. **Update the import side** in
   [`src/lib/conversations/snapshotImport.ts`](../src/lib/conversations/snapshotImport.ts)
   (or `src/lib/personas/fileOps.ts`). Default to a sensible value
   when the field is absent.

4. **Add tests** for both directions:
   - Round-trip: export → import → equality.
   - Legacy: import a snapshot without the field; assert the default
     value lands.

### Considerations

- **Don't bump the snapshot `version`** for backwards-compatible
  additions. The version bumps when an import couldn't interpret a
  legacy file at all.
- **Bundle the new field with the appropriate atomicity** — the import
  path is one transaction (#269), so a half-imported state is
  impossible.

---

## Add a conversation-level operation

"Conversation-level operation" = a multi-step DB action that mutates
several tables for one conversation (compact, fork, replay, pop, etc.).

### Steps

1. **Plan the operation** as a use case under `src/lib/app/` or as a
   conversation helper under `src/lib/conversations/`. Use cases that
   take deps go in `lib/app/`; pure helpers (no deps) can go in
   `lib/conversations/`.

2. **Decide the atomicity boundary.** Three options (see ADR 011):
   - **`transaction()`** — multiple writes must commit atomically.
   - **`withSerializedSection`** — multiple statements need same-webview
     serialization but each can commit independently.
   - **Neither** — just sequential repo calls (each goes through the
     global queue independently).

3. **Inside `transaction()`, use `reposFor(txn.db)`** instead of plain
   repo imports:

   ```ts
   import { transaction } from "@/lib/persistence/transaction";
   import { reposFor } from "@/lib/persistence/repoContext";

   await transaction(async (txn) => {
     const repos = reposFor(txn.db);
     await repos.messages.applyMessageMutation({ … });
     await repos.conversations.setCompactionFloor(id, idx);
   });
   ```

4. **Bulk-write paths** should use `bulkAppendMessages` (or the
   relevant bulk function) instead of N per-row `appendMessage` calls
   — see #278 for the rationale and chunking convention.

5. **Long-running parts** (LLM calls, file I/O) must run **outside**
   the transaction. The pattern is: gather everything you need outside,
   then open the transaction for the writes only.

6. **Test atomicity** by spying on a mid-loop call and forcing it to
   throw. Assert that the conversation is in its pre-call state after
   the rejection.

### Working examples to read

- [`src/lib/conversations/runCompaction.ts`](../src/lib/conversations/runCompaction.ts)
  / [`runCompactionCommit.ts`](../src/lib/conversations/runCompactionCommit.ts)
  — split into LLM phase (outside) and DB commit phase (inside one
  transaction). The split was driven by #268; the test at
  [`tests/unit/conversations/runCompactionCommit.test.ts`](../tests/unit/conversations/runCompactionCommit.test.ts)
  pins atomicity by spying on the third insert and asserting full
  rollback.
- [`src/lib/conversations/snapshotImport.ts`](../src/lib/conversations/snapshotImport.ts)
  — entire import is one transaction (#269); demonstrates threading
  `txn.db` across persona service calls and bulk message inserts.
- [`src/lib/app/replayMessage.ts`](../src/lib/app/replayMessage.ts) —
  use case wrapping the multi-step edit/replay write in a transaction
  while keeping the LLM regeneration outside.
