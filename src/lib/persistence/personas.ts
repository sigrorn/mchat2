// ------------------------------------------------------------------
// Component: Personas repository (Kysely-backed)
// Responsibility: CRUD over Persona rows with tombstoning.
// History:       Migrated from raw sql.execute / sql.select to Kysely
//                in #201; Phase C of #241 dropped the runs_after
//                column and the persona_runs_after junction, so the
//                read/write paths shed loadRunsAfterMap +
//                writeRunsAfter and the dual-write logic.
// Collaborators: personas/service.ts, personas/resolver.ts, ids.ts.
// ------------------------------------------------------------------

import { db } from "./db";
import type { PersonasTable } from "./schema";
import type { Persona, ProviderId } from "../types";
import { newPersonaId } from "./ids";

function rowToPersona(r: PersonasTable): Persona {
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
    deletedAt: r.deleted_at,
    apertusProductId: r.apertus_product_id ?? null,
    visibilityDefaults: parseVisibilityDefaults(r.visibility_defaults),
    openaiCompatPreset: parseOpenaiCompatPreset(r.openai_compat_preset),
    roleLens: parseRoleLens(r.role_lens),
  };
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

function parseRoleLens(raw: string): Record<string, "user" | "assistant"> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, "user" | "assistant"> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === "user" || v === "assistant") out[k] = v;
      }
      return out;
    }
  } catch {
    // ignore — return empty on malformed JSON
  }
  return {};
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
  return rows.map(rowToPersona);
}

export async function getPersona(id: string): Promise<Persona | null> {
  const row = await db
    .selectFrom("personas")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  return rowToPersona(row);
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
    deleted_at: p.deletedAt,
    apertus_product_id: p.apertusProductId,
    visibility_defaults: JSON.stringify(p.visibilityDefaults),
    openai_compat_preset: p.openaiCompatPreset
      ? JSON.stringify(p.openaiCompatPreset)
      : null,
    role_lens: JSON.stringify(p.roleLens ?? {}),
  };
}

export async function createPersona(
  partial: Omit<Persona, "id"> & { id?: string },
): Promise<Persona> {
  const p: Persona = { ...partial, id: partial.id ?? newPersonaId() };
  await db.insertInto("personas").values(personaToRow(p)).execute();
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
      deleted_at: row.deleted_at,
      apertus_product_id: row.apertus_product_id,
      visibility_defaults: row.visibility_defaults,
      openai_compat_preset: row.openai_compat_preset,
      role_lens: row.role_lens,
    })
    .where("id", "=", p.id)
    .execute();
}

export async function tombstonePersona(id: string, at: number = Date.now()): Promise<void> {
  await db
    .updateTable("personas")
    .set({ deleted_at: at })
    .where("id", "=", id)
    .execute();
}
