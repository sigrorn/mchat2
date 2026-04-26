// ------------------------------------------------------------------
// Component: Conversations repository (Kysely-backed)
// Responsibility: Persist and load Conversation rows.
// Collaborators: stores/conversations.ts, migrations.ts, ids.ts.
// History:       Migrated to Kysely in #191. Public exports keep
//                their signatures; column types come from
//                lib/persistence/schema.ts.
// ------------------------------------------------------------------

import { db } from "./db";
import type { ConversationsTable } from "./schema";
import type { Conversation, ProviderId } from "../types";
import { newConversationId } from "./ids";
import {
  parseVisibilityMatrix,
  parseAutocompactThreshold,
  parseContextWarningsFired,
} from "../schemas/conversationJsonColumns";

// #193: selectedPersonas now comes from the conversation_personas_selected
// junction, not the legacy JSON column. The column stays populated as a
// dual-write so any rollback can still read it.
function rowToConversation(r: ConversationsTable, selectedPersonas: string[]): Conversation {
  return {
    id: r.id,
    title: r.title,
    systemPrompt: r.system_prompt,
    createdAt: r.created_at,
    lastProvider: (r.last_provider as ProviderId | null) ?? null,
    limitMarkIndex: r.limit_mark_index,
    displayMode: r.display_mode === "cols" ? "cols" : "lines",
    visibilityMode: r.visibility_mode === "joined" ? "joined" : "separated",
    visibilityMatrix: parseVisibilityMatrix(r.visibility_matrix),
    limitSizeTokens: r.limit_size_tokens,
    selectedPersonas,
    compactionFloorIndex: r.compaction_floor_index,
    autocompactThreshold: parseAutocompactThreshold(r.autocompact_threshold),
    contextWarningsFired: parseContextWarningsFired(r.context_warnings_fired),
  };
}

async function loadSelectedPersonasMap(
  conversationIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (conversationIds.length === 0) return out;
  const rows = await db
    .selectFrom("conversation_personas_selected")
    .select(["conversation_id", "persona_id"])
    .where("conversation_id", "in", conversationIds)
    .execute();
  for (const id of conversationIds) out.set(id, []);
  for (const r of rows) out.get(r.conversation_id)?.push(r.persona_id);
  return out;
}

async function writeSelectedPersonas(
  conversationId: string,
  personaIds: readonly string[],
): Promise<void> {
  await db
    .deleteFrom("conversation_personas_selected")
    .where("conversation_id", "=", conversationId)
    .execute();
  if (personaIds.length === 0) return;
  await db
    .insertInto("conversation_personas_selected")
    .values(personaIds.map((pid) => ({ conversation_id: conversationId, persona_id: pid })))
    .execute();
}

function conversationToRow(conv: Conversation): ConversationsTable {
  return {
    id: conv.id,
    title: conv.title,
    system_prompt: conv.systemPrompt,
    created_at: conv.createdAt,
    last_provider: conv.lastProvider,
    limit_mark_index: conv.limitMarkIndex,
    display_mode: conv.displayMode,
    visibility_mode: conv.visibilityMode,
    visibility_matrix: JSON.stringify(conv.visibilityMatrix),
    limit_size_tokens: conv.limitSizeTokens,
    selected_personas: JSON.stringify(conv.selectedPersonas),
    compaction_floor_index: conv.compactionFloorIndex,
    autocompact_threshold: conv.autocompactThreshold
      ? JSON.stringify(conv.autocompactThreshold)
      : null,
    context_warnings_fired: JSON.stringify(conv.contextWarningsFired ?? []),
  };
}

export async function listConversations(): Promise<Conversation[]> {
  const rows = await db
    .selectFrom("conversations")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
  const selectedMap = await loadSelectedPersonasMap(rows.map((r) => r.id));
  return rows.map((r) => rowToConversation(r, selectedMap.get(r.id) ?? []));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const row = await db
    .selectFrom("conversations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const map = await loadSelectedPersonasMap([id]);
  return rowToConversation(row, map.get(id) ?? []);
}

export async function createConversation(
  partial: Omit<Conversation, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<Conversation> {
  const conv: Conversation = {
    ...partial,
    id: partial.id ?? newConversationId(),
    createdAt: partial.createdAt ?? Date.now(),
  };
  await db.insertInto("conversations").values(conversationToRow(conv)).execute();
  await writeSelectedPersonas(conv.id, conv.selectedPersonas);
  return conv;
}

export async function updateConversation(conv: Conversation): Promise<void> {
  // Kysely's set({...}) keeps the call short; the values builder
  // matches the same JSON-encoding logic as createConversation
  // (sharing conversationToRow ensures both paths agree).
  const row = conversationToRow(conv);
  await db
    .updateTable("conversations")
    .set({
      title: row.title,
      system_prompt: row.system_prompt,
      last_provider: row.last_provider,
      limit_mark_index: row.limit_mark_index,
      display_mode: row.display_mode,
      visibility_mode: row.visibility_mode,
      visibility_matrix: row.visibility_matrix,
      limit_size_tokens: row.limit_size_tokens,
      // #193: selected_personas JSON column stays as a dual-write
      // for rollback safety; reads come from the junction.
      selected_personas: row.selected_personas,
      compaction_floor_index: row.compaction_floor_index,
      autocompact_threshold: row.autocompact_threshold,
      context_warnings_fired: row.context_warnings_fired,
    })
    .where("id", "=", conv.id)
    .execute();
  await writeSelectedPersonas(conv.id, conv.selectedPersonas);
}

export async function deleteConversation(id: string): Promise<void> {
  await db.deleteFrom("conversations").where("id", "=", id).execute();
}
