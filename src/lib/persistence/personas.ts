// ------------------------------------------------------------------
// Component: Personas repository (Kysely-backed)
// Responsibility: CRUD over Persona rows with tombstoning. The
//                 runs_after junction (#195) is dual-written: writes
//                 hit both the legacy JSON column and the
//                 persona_runs_after edge table; reads come from the
//                 junction via loadRunsAfterMap.
// History:       Migrated from raw sql.execute / sql.select to Kysely
//                in #201. Public exports keep their signatures; the
//                hand-written `Row` interface is gone — column types
//                come from lib/persistence/schema.ts.
// Collaborators: personas/service.ts, personas/resolver.ts, ids.ts.
// ------------------------------------------------------------------

import { db } from "./db";
import type { PersonasTable } from "./schema";
import type { Persona, ProviderId } from "../types";
import { newPersonaId } from "./ids";

function rowToPersona(r: PersonasTable, runsAfter: string[]): Persona {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    provider: r.provider as ProviderId,
    name: r.name,
    nameSlug: r.name_slug,
    systemPromptOverride: r.system_prompt_override,
    modelOverride: r.model_override,
    colorOverride: r.color_override,
    createdAtMessageIndex: r.created_at_message_index,
    sortOrder: r.sort_order,
    // #195: read from persona_runs_after junction; legacy JSON column
    // is dual-written but no longer the read source.
    runsAfter,
    deletedAt: r.deleted_at,
    apertusProductId: r.apertus_product_id ?? null,
    visibilityDefaults: parseVisibilityDefaults(r.visibility_defaults),
    openaiCompatPreset: parseOpenaiCompatPreset(r.openai_compat_preset),
  };
}

async function loadRunsAfterMap(
  personaIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of personaIds) out.set(id, []);
  if (personaIds.length === 0) return out;
  const rows = await db
    .selectFrom("persona_runs_after")
    .select(["child_id", "parent_id"])
    .where("child_id", "in", personaIds)
    .execute();
  for (const r of rows) out.get(r.child_id)?.push(r.parent_id);
  return out;
}

async function writeRunsAfter(
  personaId: string,
  parents: readonly string[],
): Promise<void> {
  await db
    .deleteFrom("persona_runs_after")
    .where("child_id", "=", personaId)
    .execute();
  if (parents.length === 0) return;
  // ON CONFLICT DO NOTHING — defensive against the very rare case that
  // a parent doesn't resolve (e.g. an import sequence where the parent
  // persona row hasn't been created yet). Without it the FK violation
  // aborts the whole write.
  await db
    .insertInto("persona_runs_after")
    .values(parents.map((parent) => ({ child_id: personaId, parent_id: parent })))
    .onConflict((oc) => oc.doNothing())
    .execute();
}

function parseOpenaiCompatPreset(
  raw: string | null,
): Persona["openaiCompatPreset"] {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (obj.kind === "builtin" && typeof obj.id === "string") {
        return { kind: "builtin", id: obj.id };
      }
      if (obj.kind === "custom" && typeof obj.name === "string") {
        return { kind: "custom", name: obj.name };
      }
    }
  } catch {
    // ignore — soft-fail to null below
  }
  return null;
}

function parseVisibilityDefaults(raw: string): Record<string, "y" | "n"> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, "y" | "n"> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === "y" || v === "n") out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore
  }
  return {};
}

export async function listPersonas(
  conversationId: string,
  includeDeleted = false,
): Promise<Persona[]> {
  let q = db
    .selectFrom("personas")
    .selectAll()
    .where("conversation_id", "=", conversationId);
  if (!includeDeleted) q = q.where("deleted_at", "is", null);
  const rows = await q.orderBy("sort_order").orderBy("name").execute();
  const runsAfterMap = await loadRunsAfterMap(rows.map((r) => r.id));
  return rows.map((r) => rowToPersona(r, runsAfterMap.get(r.id) ?? []));
}

export async function getPersona(id: string): Promise<Persona | null> {
  const row = await db
    .selectFrom("personas")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const map = await loadRunsAfterMap([id]);
  return rowToPersona(row, map.get(id) ?? []);
}

function personaToRow(p: Persona): PersonasTable {
  return {
    id: p.id,
    conversation_id: p.conversationId,
    provider: p.provider,
    name: p.name,
    name_slug: p.nameSlug,
    system_prompt_override: p.systemPromptOverride,
    model_override: p.modelOverride,
    color_override: p.colorOverride,
    created_at_message_index: p.createdAtMessageIndex,
    sort_order: p.sortOrder,
    runs_after: JSON.stringify(p.runsAfter),
    deleted_at: p.deletedAt,
    apertus_product_id: p.apertusProductId,
    visibility_defaults: JSON.stringify(p.visibilityDefaults),
    openai_compat_preset: p.openaiCompatPreset
      ? JSON.stringify(p.openaiCompatPreset)
      : null,
  };
}

export async function createPersona(
  partial: Omit<Persona, "id"> & { id?: string },
): Promise<Persona> {
  const p: Persona = { ...partial, id: partial.id ?? newPersonaId() };
  await db.insertInto("personas").values(personaToRow(p)).execute();
  await writeRunsAfter(p.id, p.runsAfter);
  return p;
}

export async function updatePersona(p: Persona): Promise<void> {
  const row = personaToRow(p);
  await db
    .updateTable("personas")
    .set({
      provider: row.provider,
      name: row.name,
      name_slug: row.name_slug,
      system_prompt_override: row.system_prompt_override,
      model_override: row.model_override,
      color_override: row.color_override,
      sort_order: row.sort_order,
      runs_after: row.runs_after,
      deleted_at: row.deleted_at,
      apertus_product_id: row.apertus_product_id,
      visibility_defaults: row.visibility_defaults,
      openai_compat_preset: row.openai_compat_preset,
    })
    .where("id", "=", p.id)
    .execute();
  await writeRunsAfter(p.id, p.runsAfter);
}

export async function tombstonePersona(id: string, at: number = Date.now()): Promise<void> {
  await db
    .updateTable("personas")
    .set({ deleted_at: at })
    .where("id", "=", id)
    .execute();
}
