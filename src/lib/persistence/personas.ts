// ------------------------------------------------------------------
// Component: Personas repository
// Responsibility: CRUD over Persona rows with tombstoning.
// Collaborators: personas/service.ts, personas/resolver.ts, ids.ts.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";
import type { Persona, ProviderId } from "../types";
import { newPersonaId } from "./ids";

interface Row {
  id: string;
  conversation_id: string;
  provider: string;
  name: string;
  name_slug: string;
  system_prompt_override: string | null;
  model_override: string | null;
  color_override: string | null;
  created_at_message_index: number;
  sort_order: number;
  runs_after: string | null;
  deleted_at: number | null;
}

function rowToPersona(r: Row): Persona {
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
    runsAfter: r.runs_after,
    deletedAt: r.deleted_at,
  };
}

export async function listPersonas(
  conversationId: string,
  includeDeleted = false,
): Promise<Persona[]> {
  const q = includeDeleted
    ? "SELECT * FROM personas WHERE conversation_id = ? ORDER BY sort_order, name"
    : "SELECT * FROM personas WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY sort_order, name";
  const rows = await sql.select<Row>(q, [conversationId]);
  return rows.map(rowToPersona);
}

export async function getPersona(id: string): Promise<Persona | null> {
  const rows = await sql.select<Row>("SELECT * FROM personas WHERE id = ?", [id]);
  return rows[0] ? rowToPersona(rows[0]) : null;
}

export async function createPersona(
  partial: Omit<Persona, "id"> & { id?: string },
): Promise<Persona> {
  const p: Persona = { ...partial, id: partial.id ?? newPersonaId() };
  await sql.execute(
    `INSERT INTO personas
       (id, conversation_id, provider, name, name_slug,
        system_prompt_override, model_override, color_override,
        created_at_message_index, sort_order, runs_after, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.id,
      p.conversationId,
      p.provider,
      p.name,
      p.nameSlug,
      p.systemPromptOverride,
      p.modelOverride,
      p.colorOverride,
      p.createdAtMessageIndex,
      p.sortOrder,
      p.runsAfter,
      p.deletedAt,
    ],
  );
  return p;
}

export async function updatePersona(p: Persona): Promise<void> {
  await sql.execute(
    `UPDATE personas SET
       provider = ?, name = ?, name_slug = ?,
       system_prompt_override = ?, model_override = ?, color_override = ?,
       sort_order = ?, runs_after = ?, deleted_at = ?
     WHERE id = ?`,
    [
      p.provider,
      p.name,
      p.nameSlug,
      p.systemPromptOverride,
      p.modelOverride,
      p.colorOverride,
      p.sortOrder,
      p.runsAfter,
      p.deletedAt,
      p.id,
    ],
  );
}

export async function tombstonePersona(id: string, at: number = Date.now()): Promise<void> {
  await sql.execute("UPDATE personas SET deleted_at = ? WHERE id = ?", [at, id]);
}
