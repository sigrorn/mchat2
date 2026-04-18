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
];

// #98: backup the DB file before running migrations.
async function backupBeforeMigration(schemaVersion: number): Promise<string | null> {
  try {
    const { appDataDir } = await import("@tauri-apps/api/path");
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
export async function runMigrations(): Promise<number> {
  // FK checks are OFF during migrations so table rebuilds (e.g. v8's
  // persona FK removal) can DROP+RENAME without cascading. Turned ON
  // after all migrations complete for normal app runtime.
  await sql.execute("PRAGMA foreign_keys = OFF");
  const rows = await sql.select<{ user_version: number }>("PRAGMA user_version");
  const current = rows[0]?.user_version ?? 0;
  if (current >= MIGRATIONS.length) {
    await sql.execute("PRAGMA foreign_keys = ON");
    return 0;
  }

  // #98: backup before applying any migration.
  const backupPath = await backupBeforeMigration(current);

  let applied = 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const stmts = MIGRATIONS[i];
    if (!stmts) continue;
    for (const stmt of stmts) {
      await sql.execute(stmt);
    }
    await sql.execute(`PRAGMA user_version = ${i + 1}`);
    applied++;
  }
  await sql.execute("PRAGMA foreign_keys = ON");

  // #98: remove backup after successful migration.
  if (backupPath) await removeBackup(backupPath);

  return applied;
}
