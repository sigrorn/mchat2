// ------------------------------------------------------------------
// Component: Migrations
// Responsibility: Own the SQLite schema. Each migration is an idempotent
//                 ordered list of statements; runMigrations applies the
//                 ones past the current user_version.
// Collaborators: every repository under persistence/, tauri/sql.ts.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";

// Each migration = array of statements executed in one transaction.
// Never edit a committed migration; add a new one instead.
export const MIGRATIONS: string[][] = [
  // 1 — initial schema
  [
    `CREATE TABLE conversations (
      id                TEXT PRIMARY KEY,
      title             TEXT NOT NULL,
      system_prompt     TEXT,
      created_at        INTEGER NOT NULL,
      last_provider     TEXT,
      limit_mark_index  INTEGER,
      display_mode      TEXT NOT NULL DEFAULT 'lines',
      visibility_mode   TEXT NOT NULL DEFAULT 'separated'
    )`,
    `CREATE TABLE personas (
      id                          TEXT PRIMARY KEY,
      conversation_id             TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      provider                    TEXT NOT NULL,
      name                        TEXT NOT NULL,
      name_slug                   TEXT NOT NULL,
      system_prompt_override      TEXT,
      model_override              TEXT,
      color_override              TEXT,
      created_at_message_index    INTEGER NOT NULL,
      sort_order                  INTEGER NOT NULL,
      runs_after                  TEXT REFERENCES personas(id) ON DELETE SET NULL,
      deleted_at                  INTEGER
    )`,
    // Uniqueness applies only to active personas — soft-deleted tombstones
    // keep their old slug so DAG edges and pin targets survive.
    `CREATE UNIQUE INDEX idx_personas_active_slug
       ON personas(conversation_id, name_slug)
       WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_personas_conv ON personas(conversation_id)`,
    `CREATE TABLE messages (
      id                TEXT PRIMARY KEY,
      conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role              TEXT NOT NULL,
      content           TEXT NOT NULL,
      provider          TEXT,
      model             TEXT,
      persona_id        TEXT REFERENCES personas(id) ON DELETE SET NULL,
      display_mode      TEXT NOT NULL,
      pinned            INTEGER NOT NULL DEFAULT 0,
      pin_target        TEXT,
      addressed_to      TEXT NOT NULL DEFAULT '[]',
      created_at        INTEGER NOT NULL,
      idx               INTEGER NOT NULL,
      error_message     TEXT,
      error_transient   INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX idx_messages_conv_idx ON messages(conversation_id, idx)`,
    `CREATE INDEX idx_messages_conv ON messages(conversation_id)`,
    `CREATE TABLE settings (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    )`,
  ],
  // 2 — token accounting columns on messages (issue #2)
  [
    `ALTER TABLE messages ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN usage_estimated INTEGER NOT NULL DEFAULT 0`,
  ],
  // 3 — assistant audience (issue #4). JSON-encoded persona key list.
  [`ALTER TABLE messages ADD COLUMN audience TEXT NOT NULL DEFAULT '[]'`],
  // 4 — Apertus product id on personas (issue #15).
  [`ALTER TABLE personas ADD COLUMN apertus_product_id TEXT`],
  // 5 — Per-persona visibility matrix on conversations (#52).
  [`ALTER TABLE conversations ADD COLUMN visibility_matrix TEXT NOT NULL DEFAULT '{}'`],
  // 6 — Sliding token-budget limit on conversations (#64).
  [`ALTER TABLE conversations ADD COLUMN limit_size_tokens INTEGER`],
  // 7 — Persisted persona selection (#65).
  [`ALTER TABLE conversations ADD COLUMN selected_personas TEXT NOT NULL DEFAULT '[]'`],
  // 8 — Multi-parent runsAfter (#66): drop the FK constraint on
  // runs_after (it now stores a JSON array, not a single persona id)
  // and convert existing values. SQLite requires a table rebuild to
  // remove a FK constraint.
  [
    `DROP TABLE IF EXISTS personas_new`,
    `CREATE TABLE personas_new (
      id                          TEXT PRIMARY KEY,
      conversation_id             TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      provider                    TEXT NOT NULL,
      name                        TEXT NOT NULL,
      name_slug                   TEXT NOT NULL,
      system_prompt_override      TEXT,
      model_override              TEXT,
      color_override              TEXT,
      created_at_message_index    INTEGER NOT NULL,
      sort_order                  INTEGER NOT NULL,
      runs_after                  TEXT NOT NULL DEFAULT '[]',
      deleted_at                  INTEGER,
      apertus_product_id          TEXT
    )`,
    `INSERT INTO personas_new SELECT
      id, conversation_id, provider, name, name_slug,
      system_prompt_override, model_override, color_override,
      created_at_message_index, sort_order,
      CASE
        WHEN runs_after IS NULL OR runs_after = '' THEN '[]'
        ELSE '["' || runs_after || '"]'
      END,
      deleted_at, apertus_product_id
    FROM personas`,
    `DROP TABLE personas`,
    `ALTER TABLE personas_new RENAME TO personas`,
    `CREATE UNIQUE INDEX idx_personas_active_slug
       ON personas(conversation_id, name_slug)
       WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_personas_conv ON personas(conversation_id)`,
  ],
  // 9 — Per-persona visibility defaults (#94).
  [`ALTER TABLE personas ADD COLUMN visibility_defaults TEXT NOT NULL DEFAULT '{}'`],
  // 10 — Compaction floor index on conversations (#102).
  [`ALTER TABLE conversations ADD COLUMN compaction_floor_index INTEGER`],
  // 11 — Autocompact threshold on conversations (#105).
  [
    `ALTER TABLE conversations ADD COLUMN autocompact_threshold TEXT`,
    `ALTER TABLE conversations ADD COLUMN context_warnings_fired TEXT NOT NULL DEFAULT '[]'`,
  ],
  // 12 — Per-message streaming timings (#122).
  // ttft_ms: ms from stream-open to first token event.
  // stream_ms: ms from first token to complete event.
  // Nullable; populated only for streamed assistant rows that
  // completed successfully.
  [
    `ALTER TABLE messages ADD COLUMN ttft_ms INTEGER`,
    `ALTER TABLE messages ADD COLUMN stream_ms INTEGER`,
  ],
  // 13 — openai_compat preset reference on personas (#140 → #171).
  // JSON-encoded {kind:"builtin"|"custom", id?:string, name?:string}.
  // Null when the persona uses a native provider. Existing personas
  // (Apertus included) stay null and continue using their native
  // adapter; the new openai_compat path is purely additive.
  [`ALTER TABLE personas ADD COLUMN openai_compat_preset TEXT`],
  // 14 — Run / RunTarget / Attempt state machine (#174 → #175).
  // Hoists orchestration state out of the messages table and into a
  // first-class model. Backfill creates 1 Run x 1 RunTarget x 1 Attempt
  // per existing assistant message; orphaned rows (NULL persona_id)
  // are skipped because they predate the persona requirement.
  [
    `CREATE TABLE runs (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      completed_at    INTEGER
    )`,
    `CREATE INDEX idx_runs_conv ON runs(conversation_id)`,
    `CREATE TABLE run_targets (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      target_key  TEXT NOT NULL,
      persona_id  TEXT REFERENCES personas(id) ON DELETE SET NULL,
      provider    TEXT,
      model       TEXT,
      status      TEXT NOT NULL
    )`,
    `CREATE INDEX idx_run_targets_run ON run_targets(run_id)`,
    `CREATE TABLE attempts (
      id              TEXT PRIMARY KEY,
      run_target_id   TEXT NOT NULL REFERENCES run_targets(id) ON DELETE CASCADE,
      sequence        INTEGER NOT NULL,
      content         TEXT NOT NULL,
      started_at      INTEGER NOT NULL,
      completed_at    INTEGER,
      error_message   TEXT,
      error_transient INTEGER NOT NULL DEFAULT 0,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      ttft_ms         INTEGER,
      stream_ms       INTEGER,
      superseded_at   INTEGER
    )`,
    `CREATE INDEX idx_attempts_run_target ON attempts(run_target_id)`,
    // Backfill: one Run per legacy assistant message. The message id is
    // the seed for run/target/attempt ids so backfilled rows are
    // round-trippable in tests.
    `INSERT INTO runs (id, conversation_id, kind, started_at, completed_at)
       SELECT 'run_' || m.id, m.conversation_id, 'send', m.created_at, m.created_at
         FROM messages m
        WHERE m.role = 'assistant' AND m.persona_id IS NOT NULL`,
    `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
       SELECT 'rt_' || m.id, 'run_' || m.id,
              COALESCE(p.name_slug, m.persona_id),
              m.persona_id, m.provider, m.model,
              CASE WHEN m.error_message IS NULL THEN 'complete' ELSE 'error' END
         FROM messages m
         LEFT JOIN personas p ON p.id = m.persona_id
        WHERE m.role = 'assistant' AND m.persona_id IS NOT NULL`,
    `INSERT INTO attempts (id, run_target_id, sequence, content, started_at,
                           completed_at, error_message, error_transient,
                           input_tokens, output_tokens, ttft_ms, stream_ms,
                           superseded_at)
       SELECT 'att_' || m.id, 'rt_' || m.id, 1, m.content, m.created_at,
              m.created_at, m.error_message, m.error_transient,
              m.input_tokens, m.output_tokens, m.ttft_ms, m.stream_ms, NULL
         FROM messages m
        WHERE m.role = 'assistant' AND m.persona_id IS NOT NULL`,
  ],
  // 15 — Normalize selected_personas → junction table (#192 → #193).
  // The old conversations.selected_personas JSON column stays for
  // now; reads/writes move to the junction. A future cleanup can
  // drop the column once we've confirmed nothing else reads it.
  [
    `CREATE TABLE conversation_personas_selected (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      persona_id      TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      PRIMARY KEY (conversation_id, persona_id)
    )`,
    `CREATE INDEX idx_conv_personas_selected_persona
       ON conversation_personas_selected(persona_id)`,
    // Backfill: parse the JSON string in selected_personas via SQLite's
    // json_each, INSERT one row per element. The JOIN against personas
    // by (id, conversation_id) skips ids that don't resolve to a real
    // persona row in the same conversation — defensive against
    // half-stale JSON data.
    `INSERT INTO conversation_personas_selected (conversation_id, persona_id)
       SELECT c.id, p.id
         FROM conversations c, json_each(c.selected_personas) j
         JOIN personas p ON p.id = j.value AND p.conversation_id = c.id`,
  ],
  // 16 — Normalize visibility (#192 → #194). Combines
  // conversations.visibility_matrix (id-keyed JSON of observer→sources)
  // with personas.visibility_defaults (slug-keyed JSON of other→y/n)
  // into a single relational table. The legacy JSON columns stay
  // populated as a dual-write safety net; the read path's switch is
  // deferred to a follow-up.
  [
    `CREATE TABLE persona_visibility (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      observer_slug   TEXT NOT NULL,
      source_slug     TEXT NOT NULL,
      visible         INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, observer_slug, source_slug)
    )`,
    // Backfill order matters: defaults first, matrix on top. SQLite
    // INSERT OR REPLACE on the composite PK means the matrix-derived
    // row supersedes the defaults-derived row when both exist.
    //
    // Step 1: visibility_defaults — each persona's view of who they
    // can see. Slug-keyed JSON, so observer is the persona's own
    // name_slug, source is the JSON key, visible is 1 for 'y' and
    // 0 for 'n'.
    `INSERT INTO persona_visibility (conversation_id, observer_slug, source_slug, visible)
       SELECT p.conversation_id, p.name_slug, j.key,
              CASE WHEN j.value = 'y' THEN 1 ELSE 0 END
         FROM personas p, json_each(p.visibility_defaults) j`,
    // Step 2: visibility_matrix — id-keyed observer to id-array of
    // sources. Translate ids to slugs via the personas table for both
    // sides. visible=1 because matrix entries are explicit allow-rows.
    `INSERT OR REPLACE INTO persona_visibility (conversation_id, observer_slug, source_slug, visible)
       SELECT c.id, observer.name_slug, source.name_slug, 1
         FROM conversations c, json_each(c.visibility_matrix) outer_j,
              json_each(outer_j.value) inner_j
         JOIN personas observer ON observer.id = outer_j.key
                              AND observer.conversation_id = c.id
         JOIN personas source ON source.id = inner_j.value
                            AND source.conversation_id = c.id`,
  ],
  // 17 — Normalize runs_after → edge table (#192 → #195). The legacy
  // JSON column stays populated as a dual-write rollback safety net;
  // reads switch to this table.
  [
    `CREATE TABLE persona_runs_after (
      child_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      parent_id TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      PRIMARY KEY (child_id, parent_id)
    )`,
    `CREATE INDEX idx_persona_runs_after_parent ON persona_runs_after(parent_id)`,
    // Backfill: each persona's runs_after JSON array becomes one
    // edge row per parent id. The JOIN against personas filters out
    // orphans (parents that don't resolve to a real row) — would
    // otherwise fail the FK constraint.
    `INSERT INTO persona_runs_after (child_id, parent_id)
       SELECT child.id, parent.id
         FROM personas child, json_each(child.runs_after) j
         JOIN personas parent ON parent.id = j.value
                              AND parent.conversation_id = child.conversation_id`,
  ],
  // 18 — Normalize context_warnings_fired → table (#192 → #196).
  // Adds a fired_at timestamp the JSON form lacked. Legacy column
  // stays populated as a dual-write rollback safety net; reads
  // switch to this table.
  [
    `CREATE TABLE conversation_context_warnings (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      threshold       INTEGER NOT NULL,
      fired_at        INTEGER NOT NULL,
      PRIMARY KEY (conversation_id, threshold)
    )`,
    // Backfill: each threshold in the JSON array becomes one row;
    // fired_at is best-approximated as the conversation's created_at
    // (the JSON form didn't carry per-threshold timestamps).
    `INSERT INTO conversation_context_warnings (conversation_id, threshold, fired_at)
       SELECT c.id, CAST(j.value AS INTEGER), c.created_at
         FROM conversations c, json_each(c.context_warnings_fired) j`,
  ],
  // 19 — Message-level superseded marker (#206 follow-up). The
  // attempt-id-keyed superseded mechanism from #180 only worked for
  // pre-#179 backfill rows and post-#205 sends — messages created
  // between those points have random att_<random> ids that
  // listSupersededMessageIds couldn't map back to a message id. A
  // direct messages.superseded_at column makes the hide-on-replay /
  // hide-on-retry behavior work regardless of attempt-id format.
  // Reads (UI filter, context builder) consult this column;
  // attempts.superseded_at retains its per-attempt-history meaning
  // for the future #181 affordance.
  [
    `ALTER TABLE messages ADD COLUMN superseded_at INTEGER`,
  ],
  // 20 — Persona role lens (#213, slice 1 of #212). JSON map
  // { speakerKey -> "user" | "assistant" } where speakerKey is either
  // a persona-id or the literal "user". Default '{}' = no overrides;
  // buildContext's role mapping is unchanged for empty lenses.
  [
    `ALTER TABLE personas ADD COLUMN role_lens TEXT NOT NULL DEFAULT '{}'`,
  ],
  // 21 — Conversation flow tables + runs.flow_step_id (#215, slice 3
  // of #212). Per-conversation cyclic ordered list of steps, each
  // either 'user' (pause for input) or 'personas' (parallel set of
  // personas that all run before the flow advances). Runs gain a
  // nullable flow_step_id so edit/replay (#219) can rewind the cursor
  // to the user step that fed a given Run.
  [
    `CREATE TABLE flows (
      id                 TEXT PRIMARY KEY,
      conversation_id    TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
      current_step_index INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE flow_steps (
      id        TEXT PRIMARY KEY,
      flow_id   TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
      sequence  INTEGER NOT NULL,
      kind      TEXT NOT NULL CHECK (kind IN ('user', 'personas')),
      UNIQUE (flow_id, sequence)
    )`,
    `CREATE INDEX idx_flow_steps_flow ON flow_steps(flow_id)`,
    `CREATE TABLE flow_step_personas (
      flow_step_id TEXT NOT NULL REFERENCES flow_steps(id) ON DELETE CASCADE,
      persona_id   TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
      PRIMARY KEY (flow_step_id, persona_id)
    )`,
    // SQLite doesn't support ADD COLUMN with FK on older versions; use
    // a nullable TEXT and rely on the runtime CASCADE/SET NULL via the
    // application layer. v8 / v14 already mix in FK constraints so
    // ADD COLUMN with REFERENCES is supported here.
    `ALTER TABLE runs ADD COLUMN flow_step_id TEXT REFERENCES flow_steps(id) ON DELETE SET NULL`,
  ],
  // 22 — Configurable flow loop-back step (#220). The cycle wraps to
  // `loop_start_index` instead of always 0, letting the leading
  // [0, loop_start_index) steps run once as a setup phase before the
  // repeating cycle takes over. Default 0 preserves today's
  // wrap-to-step-0 behaviour for every existing flow.
  [
    `ALTER TABLE flows ADD COLUMN loop_start_index INTEGER NOT NULL DEFAULT 0`,
  ],
  // 23 — Conversation flow-mode flag (#223). Tracks whether the
  // conversation's persona selection is currently being auto-managed
  // by the flow. Off by default; flips on when a flow-advancing send
  // succeeds, flips off when the user manually edits the persona
  // selection. Persisted so the state survives reload.
  [
    `ALTER TABLE conversations ADD COLUMN flow_mode INTEGER NOT NULL DEFAULT 0`,
  ],
  // 24 — Notice confirm-and-hide marker (#229). Nullable timestamp
  // (ms epoch) set when the user clicks the checkbox on a notice row;
  // the renderer hides confirmed rows. Mirrors the superseded_at
  // pattern from v19. No backfill needed — every existing row is
  // implicitly unconfirmed (NULL).
  [
    `ALTER TABLE messages ADD COLUMN confirmed_at INTEGER`,
  ],
  // 25 — Per-step hidden instruction on flow_steps (#230). Nullable
  // TEXT — buildContext appends "Step note: <instruction>" to the
  // system prompt of every persona dispatched at this step when set.
  // Existing steps backfill to NULL (no extra instruction).
  [
    `ALTER TABLE flow_steps ADD COLUMN instruction TEXT`,
  ],
  // 26 — Flow-dispatch marker on user messages (#231). 0/1 flag set
  // when sendMessage's dispatchPlan.shouldDispatchAsFlow is true,
  // so the chat header can render "→ conversation → @claudio" and
  // distinguish a flow turn from an explicit @a,@b multi-target send.
  // Default 0 preserves today's rendering for every existing row.
  [
    `ALTER TABLE messages ADD COLUMN flow_dispatched INTEGER NOT NULL DEFAULT 0`,
  ],
  // 27 — Drop the legacy runs_after persistence layer (#241 Phase C).
  // The persona-editor field went away in Phase A; the read paths
  // went away in Phase B. By the time this migration runs, every
  // conversation that opened post-Phase 0 has had its runs_after
  // edges folded into a flow + appended a notice. Stragglers (DBs
  // upgraded directly from pre-Phase-0) lose the ordering — the
  // personas keep working, just without the legacy DAG; the user
  // can rebuild ordering through the flow editor.
  [
    `DROP TABLE IF EXISTS persona_runs_after`,
    // SQLite ≥ 3.35 supports ALTER TABLE ... DROP COLUMN. Tauri ships
    // a version newer than that; mirror the pattern used by other
    // ALTER TABLE migrations in this file.
    `ALTER TABLE personas DROP COLUMN runs_after`,
  ],
];

// #98: backup the DB file before running migrations.
async function backupBeforeMigration(schemaVersion: number): Promise<string | null> {
  try {
    const { appDataDir } = await import("../tauri/path");
    const dir = await appDataDir();
    const sep = dir.includes("\\") ? "\\" : "/";
    const dbPath = `${dir}${sep}mchat2.db`;
    const backupPath = `${dir}${sep}mchat2.${schemaVersion}.db`;
    const { fs } = await import("../tauri/filesystem");
    if (await fs.exists(backupPath)) return null;
    await fs.copyFile(dbPath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

async function removeBackup(path: string): Promise<void> {
  try {
    const { fs } = await import("../tauri/filesystem");
    await fs.removeFile(path);
  } catch {
    // Silent — backup removal is best-effort.
  }
}

// Runs pending migrations against the open DB. Uses SQLite user_version
// instead of a table to keep the schema self-describing.
//
// `upTo` (test-only) caps migrations applied so a test can seed legacy
// data at an intermediate version before the new migration runs.
export async function runMigrations(upTo?: number): Promise<number> {
  // #206: contention from the dual-write pattern (#193-#196) was
  // surfacing as 'database is locked' errors in production because
  // Tauri-plugin-sql's sqlx::SqlitePool runs queries against a
  // multi-connection pool and SQLite's default rollback journal
  // doesn't allow concurrent writes. WAL lets one writer + many
  // readers coexist without blocking each other; busy_timeout makes
  // the second simultaneous writer wait up to 5s instead of failing
  // immediately. Set once on first open; SQLite persists the WAL
  // mode change in the file header so subsequent opens inherit it.
  await sql.execute("PRAGMA journal_mode = WAL");
  await sql.execute("PRAGMA busy_timeout = 5000");
  // FK checks are OFF during migrations so table rebuilds (e.g. v8's
  // persona FK removal) can DROP+RENAME without cascading. Turned ON
  // after all migrations complete for normal app runtime.
  await sql.execute("PRAGMA foreign_keys = OFF");
  const rows = await sql.select<{ user_version: number }>("PRAGMA user_version");
  const current = rows[0]?.user_version ?? 0;
  const target = upTo ?? MIGRATIONS.length;
  if (current >= target) {
    await sql.execute("PRAGMA foreign_keys = ON");
    return 0;
  }

  // #98: backup before applying any migration.
  const backupPath = await backupBeforeMigration(current);

  let applied = 0;
  for (let i = current; i < target; i++) {
    const stmts = MIGRATIONS[i];
    if (!stmts) continue;
    // #125: wrap each version bump in a transaction so a mid-migration
    // failure rolls back to the prior user_version instead of leaving
    // the DB in a half-altered state. user_version itself is set inside
    // the transaction so it's atomic with the schema change.
    await sql.execute("BEGIN IMMEDIATE");
    try {
      for (const stmt of stmts) {
        await sql.execute(stmt);
      }
      await sql.execute(`PRAGMA user_version = ${i + 1}`);
      await sql.execute("COMMIT");
    } catch (err) {
      try {
        await sql.execute("ROLLBACK");
      } catch {
        // Silent — if ROLLBACK itself fails there's nothing we can
        // recover; surface the original error below.
      }
      await sql.execute("PRAGMA foreign_keys = ON");
      throw err;
    }
    applied++;
  }
  await sql.execute("PRAGMA foreign_keys = ON");

  // #98: remove backup after successful migration.
  if (backupPath) await removeBackup(backupPath);

  return applied;
}
