// ------------------------------------------------------------------
// Component: Settings repository (Kysely-backed)
// Responsibility: Key/value storage for non-secret app settings
//                 (theme, last-opened conversation, etc.). Keys live in
//                 a flat keyspace; callers namespace by convention.
// History:       Migrated from raw sql.execute / sql.select to Kysely
//                in #201. Public exports keep their signatures;
//                column types come from lib/persistence/schema.ts.
// Collaborators: config.ts, stores/app.ts.
// ------------------------------------------------------------------

import { db } from "./db";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insertInto("settings")
    .values({ key, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}

export async function deleteSetting(key: string): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", key).execute();
}
