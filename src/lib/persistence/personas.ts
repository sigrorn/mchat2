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
  apertus_product_id?: string | null;
  visibility_defaults?: string | null;
  openai_compat_preset?: string | null;
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
    runsAfter: parseRunsAfter(r.runs_after),
    deletedAt: r.deleted_at,
    apertusProductId: r.apertus_product_id ?? null,
    visibilityDefaults: parseVisibilityDefaults(r.visibility_defaults),
    openaiCompatPreset: parseOpenaiCompatPreset(r.openai_compat_preset),
  };
}

function parseOpenaiCompatPreset(
  raw: string | null | undefined,
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

function parseRunsAfter(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    // Pre-migration single id string.
  }
  return raw ? [raw] : [];
}

function parseVisibilityDefaults(raw: string | null | undefined): Record<string, "y" | "n"> {
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
        created_at_message_index, sort_order, runs_after, deleted_at,
        apertus_product_id, visibility_defaults, openai_compat_preset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(p.runsAfter),
      p.deletedAt,
      p.apertusProductId,
      JSON.stringify(p.visibilityDefaults),
      p.openaiCompatPreset ? JSON.stringify(p.openaiCompatPreset) : null,
    ],
  );
  return p;
}

export async function updatePersona(p: Persona): Promise<void> {
  await sql.execute(
    `UPDATE personas SET
       provider = ?, name = ?, name_slug = ?,
       system_prompt_override = ?, model_override = ?, color_override = ?,
       sort_order = ?, runs_after = ?, deleted_at = ?,
       apertus_product_id = ?, visibility_defaults = ?,
       openai_compat_preset = ?
     WHERE id = ?`,
    [
      p.provider,
      p.name,
      p.nameSlug,
      p.systemPromptOverride,
      p.modelOverride,
      p.colorOverride,
      p.sortOrder,
      JSON.stringify(p.runsAfter),
      p.deletedAt,
      p.apertusProductId,
      JSON.stringify(p.visibilityDefaults),
      p.openaiCompatPreset ? JSON.stringify(p.openaiCompatPreset) : null,
      p.id,
    ],
  );
}

export async function tombstonePersona(id: string, at: number = Date.now()): Promise<void> {
  await sql.execute("UPDATE personas SET deleted_at = ? WHERE id = ?", [at, id]);
}
