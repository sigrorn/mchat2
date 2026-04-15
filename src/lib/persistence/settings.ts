// ------------------------------------------------------------------
// Component: Settings repository
// Responsibility: Key/value storage for non-secret app settings
//                 (theme, last-opened conversation, etc.). Keys live in
//                 a flat keyspace; callers namespace by convention.
// Collaborators: config.ts, stores/app.ts.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";

export async function getSetting(key: string): Promise<string | null> {
  const rows = await sql.select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [
    key,
  ]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await sql.execute(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function deleteSetting(key: string): Promise<void> {
  await sql.execute("DELETE FROM settings WHERE key = ?", [key]);
}
