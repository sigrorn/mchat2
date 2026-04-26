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
  parseSelectedPersonas,
} from "../schemas/conversationJsonColumns";

function rowToConversation(r: ConversationsTable): Conversation {
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
    selectedPersonas: parseSelectedPersonas(r.selected_personas),
    compactionFloorIndex: r.compaction_floor_index,
    autocompactThreshold: parseAutocompactThreshold(r.autocompact_threshold),
    contextWarningsFired: parseContextWarningsFired(r.context_warnings_fired),
  };
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
  return rows.map(rowToConversation);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const row = await db
    .selectFrom("conversations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? rowToConversation(row) : null;
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
      selected_personas: row.selected_personas,
      compaction_floor_index: row.compaction_floor_index,
      autocompact_threshold: row.autocompact_threshold,
      context_warnings_fired: row.context_warnings_fired,
    })
    .where("id", "=", conv.id)
    .execute();
}

export async function deleteConversation(id: string): Promise<void> {
  await db.deleteFrom("conversations").where("id", "=", id).execute();
}
