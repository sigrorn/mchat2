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
import { parseAutocompactThreshold } from "../schemas/conversationJsonColumns";

// #193: selectedPersonas comes from conversation_personas_selected.
// #196: contextWarningsFired comes from conversation_context_warnings.
// #202: visibilityMatrix comes from persona_visibility (slug-keyed
// table → translated back to id-keyed sparse matrix at load). All
// legacy JSON columns stay populated as dual-write rollback safety nets.
function rowToConversation(
  r: ConversationsTable,
  selectedPersonas: string[],
  contextWarningsFired: number[],
  visibilityMatrix: Record<string, string[]>,
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
    visibilityMatrix,
    limitSizeTokens: r.limit_size_tokens,
    selectedPersonas,
    compactionFloorIndex: r.compaction_floor_index,
    autocompactThreshold: parseAutocompactThreshold(r.autocompact_threshold),
    contextWarningsFired,
    flowMode: r.flow_mode === 1,
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

// #202: load the visibility matrix (id-keyed Record<observerId, sourceId[]>)
// for a batch of conversations from persona_visibility. Joins twice
// against personas to translate observer/source slugs back to ids.
// Sparse-matrix semantics preserved: observers with no visible=0 row
// are omitted (full visibility). Soft-deleted personas are filtered
// out so deleted persona slugs don't surface as orphan rows.
async function loadVisibilityMatrixMap(
  conversationIds: readonly string[],
): Promise<Map<string, Record<string, string[]>>> {
  const out = new Map<string, Record<string, string[]>>();
  for (const id of conversationIds) out.set(id, {});
  if (conversationIds.length === 0) return out;
  const rows = await db
    .selectFrom("persona_visibility as pv")
    .innerJoin("personas as observer", (join) =>
      join
        .onRef("observer.conversation_id", "=", "pv.conversation_id")
        .onRef("observer.name_slug", "=", "pv.observer_slug"),
    )
    .innerJoin("personas as source", (join) =>
      join
        .onRef("source.conversation_id", "=", "pv.conversation_id")
        .onRef("source.name_slug", "=", "pv.source_slug"),
    )
    .select([
      "pv.conversation_id as conversation_id",
      "observer.id as observer_id",
      "source.id as source_id",
      "pv.visible as visible",
    ])
    .where("pv.conversation_id", "in", conversationIds)
    .where("observer.deleted_at", "is", null)
    .where("source.deleted_at", "is", null)
    .execute();
  const byConv = new Map<string, Map<string, { src: string; vis: number }[]>>();
  for (const r of rows) {
    let conv = byConv.get(r.conversation_id);
    if (!conv) {
      conv = new Map();
      byConv.set(r.conversation_id, conv);
    }
    let obs = conv.get(r.observer_id);
    if (!obs) {
      obs = [];
      conv.set(r.observer_id, obs);
    }
    obs.push({ src: r.source_id, vis: Number(r.visible) });
  }
  for (const [convId, observers] of byConv) {
    const matrix: Record<string, string[]> = {};
    for (const [observerId, entries] of observers) {
      const hasAnyHidden = entries.some((e) => e.vis === 0);
      if (!hasAnyHidden) continue;
      matrix[observerId] = entries.filter((e) => e.vis === 1).map((e) => e.src);
    }
    out.set(convId, matrix);
  }
  return out;
}

// #202: write a conversation's visibility matrix to persona_visibility.
// Translates observer/source ids back to slugs, then DELETE+INSERTs.
// For each observer present in the matrix, every other persona gets a
// row with visible=1 (in the list) or visible=0 (not in the list).
// Observers absent from the matrix get no rows (full visibility — the
// sparse-matrix convention). Exported so the rebuild helper can call
// in without re-implementing the slug-translation logic.
export async function writeVisibilityMatrix(
  conversationId: string,
  matrix: Record<string, string[]>,
): Promise<void> {
  const personas = await db
    .selectFrom("personas")
    .select(["id", "name_slug"])
    .where("conversation_id", "=", conversationId)
    .where("deleted_at", "is", null)
    .execute();
  const idToSlug = new Map(personas.map((p) => [p.id, p.name_slug]));
  await db
    .deleteFrom("persona_visibility")
    .where("conversation_id", "=", conversationId)
    .execute();
  const inserts: {
    conversation_id: string;
    observer_slug: string;
    source_slug: string;
    visible: number;
  }[] = [];
  for (const [observerId, sourceIds] of Object.entries(matrix)) {
    const observerSlug = idToSlug.get(observerId);
    if (!observerSlug) continue;
    const visibleSet = new Set(sourceIds);
    for (const persona of personas) {
      if (persona.id === observerId) continue;
      inserts.push({
        conversation_id: conversationId,
        observer_slug: observerSlug,
        source_slug: persona.name_slug,
        visible: visibleSet.has(persona.id) ? 1 : 0,
      });
    }
  }
  if (inserts.length === 0) return;
  await db.insertInto("persona_visibility").values(inserts).execute();
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
    flow_mode: conv.flowMode ? 1 : 0,
  };
}

export async function listConversations(): Promise<Conversation[]> {
  const rows = await db
    .selectFrom("conversations")
    .selectAll()
    .orderBy("created_at", "desc")
    .execute();
  const ids = rows.map((r) => r.id);
  const [selectedMap, warningsMap, matrixMap] = await Promise.all([
    loadSelectedPersonasMap(ids),
    loadContextWarningsMap(ids),
    loadVisibilityMatrixMap(ids),
  ]);
  return rows.map((r) =>
    rowToConversation(
      r,
      selectedMap.get(r.id) ?? [],
      warningsMap.get(r.id) ?? [],
      matrixMap.get(r.id) ?? {},
    ),
  );
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const row = await db
    .selectFrom("conversations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!row) return null;
  const [selectedMap, warningsMap, matrixMap] = await Promise.all([
    loadSelectedPersonasMap([id]),
    loadContextWarningsMap([id]),
    loadVisibilityMatrixMap([id]),
  ]);
  return rowToConversation(
    row,
    selectedMap.get(id) ?? [],
    warningsMap.get(id) ?? [],
    matrixMap.get(id) ?? {},
  );
}

export async function createConversation(
  partial: Omit<Conversation, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<Conversation> {
  const conv: Conversation = {
    ...partial,
    id: partial.id ?? newConversationId(),
    createdAt: partial.createdAt ?? Date.now(),
    // #223: normalise flowMode to a real boolean so callers reading
    // the returned object don't see undefined for the default.
    flowMode: partial.flowMode ?? false,
  };
  await db.insertInto("conversations").values(conversationToRow(conv)).execute();
  await writeSelectedPersonas(conv.id, conv.selectedPersonas);
  await writeContextWarnings(
    conv.id,
    conv.contextWarningsFired ?? [],
    conv.createdAt,
  );
  // #202: dual-write the visibility matrix to persona_visibility.
  // No-op on a fresh conversation (no personas yet → no rows); kept
  // here for symmetry so anyone calling createConversation with a
  // pre-populated matrix gets it relationally too.
  await writeVisibilityMatrix(conv.id, conv.visibilityMatrix);
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
      flow_mode: row.flow_mode,
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
  // #202: persona_visibility is now the read source for visibilityMatrix;
  // dual-write here so every UpdateConversation rewrite of the matrix
  // is reflected relationally. Reads in the same flow will see this
  // immediately on the next loadVisibilityMatrixMap call.
  await writeVisibilityMatrix(conv.id, conv.visibilityMatrix);
}

export async function deleteConversation(id: string): Promise<void> {
  await db.deleteFrom("conversations").where("id", "=", id).execute();
}
