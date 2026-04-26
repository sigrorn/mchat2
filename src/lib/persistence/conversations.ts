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
} from "../schemas/conversationJsonColumns";

// #193: selectedPersonas comes from the conversation_personas_selected
// junction. #196: contextWarningsFired comes from
// conversation_context_warnings. Both legacy JSON columns stay
// populated as dual-write rollback safety nets.
function rowToConversation(
  r: ConversationsTable,
  selectedPersonas: string[],
  contextWarningsFired: number[],
): Conversation {
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
    contextWarningsFired,
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

// #196: load context warning thresholds for a batch of conversations.
async function loadContextWarningsMap(
  conversationIds: readonly string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const id of conversationIds) out.set(id, []);
  if (conversationIds.length === 0) return out;
  const rows = await db
    .selectFrom("conversation_context_warnings")
    .select(["conversation_id", "threshold"])
    .where("conversation_id", "in", conversationIds)
    .orderBy("threshold")
    .execute();
  for (const r of rows) out.get(r.conversation_id)?.push(r.threshold);
  return out;
}

async function writeContextWarnings(
  conversationId: string,
  thresholds: readonly number[],
  now: number,
): Promise<void> {
  await db
    .deleteFrom("conversation_context_warnings")
    .where("conversation_id", "=", conversationId)
    .execute();
  if (thresholds.length === 0) return;
  await db
    .insertInto("conversation_context_warnings")
    .values(
      thresholds.map((t) => ({
        conversation_id: conversationId,
        threshold: t,
        fired_at: now,
      })),
    )
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
  const ids = rows.map((r) => r.id);
  const [selectedMap, warningsMap] = await Promise.all([
    loadSelectedPersonasMap(ids),
    loadContextWarningsMap(ids),
  ]);
  return rows.map((r) =>
    rowToConversation(r, selectedMap.get(r.id) ?? [], warningsMap.get(r.id) ?? []),
  );
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const row = await db
    .selectFrom("conversations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const [selectedMap, warningsMap] = await Promise.all([
    loadSelectedPersonasMap([id]),
    loadContextWarningsMap([id]),
  ]);
  return rowToConversation(row, selectedMap.get(id) ?? [], warningsMap.get(id) ?? []);
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
  await writeContextWarnings(
    conv.id,
    conv.contextWarningsFired ?? [],
    conv.createdAt,
  );
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
  // #196: rewrite warning rows. fired_at uses the current time; the
  // legacy JSON form had no per-threshold timestamp anyway, and
  // setContextWarningsFired in conversationsStore is the only writer
  // — it's called when a new threshold trips, so "now" matches the
  // actual firing moment.
  await writeContextWarnings(
    conv.id,
    conv.contextWarningsFired ?? [],
    Date.now(),
  );
}

export async function deleteConversation(id: string): Promise<void> {
  await db.deleteFrom("conversations").where("id", "=", id).execute();
}
