// ------------------------------------------------------------------
// Component: Visibility rebuild helper (#202)
// Responsibility: Recomputes a conversation's visibility matrix from
//                 the current per-persona visibility defaults and
//                 writes it through to persona_visibility (and dual-
//                 writes the legacy JSON column on the conversation
//                 row). Replaces the buildMatrixFromDefaults +
//                 setVisibilityMatrix pair that previously lived in
//                 personas/service.ts.
// History:       Introduced in #202 alongside the read-path switch
//                from conversations.visibility_matrix JSON to
//                persona_visibility relational rows.
// Collaborators: persistence/conversations (writeVisibilityMatrix),
//                persistence/personas (listPersonas), PersonaPanel,
//                commands/handlers/visibility.
// ------------------------------------------------------------------

import * as personasRepo from "../persistence/personas";
import * as conversationsRepo from "../persistence/conversations";
import { db } from "../persistence/db";
import type { Persona } from "../types";

// Sparse-matrix construction from per-persona defaults. An observer
// persona gets a matrix entry only if at least one of its defaults is
// 'n' (i.e. it explicitly hides someone). The entry lists the source
// persona ids that the observer DOES see.
function computeMatrixFromPersonaDefaults(
  personas: readonly Persona[],
): Record<string, string[]> {
  const matrix: Record<string, string[]> = {};
  for (const persona of personas) {
    const entries = Object.entries(persona.visibilityDefaults);
    if (entries.length === 0) continue;
    const hasAnyNo = entries.some(([, v]) => v === "n");
    if (!hasAnyNo) continue;
    const row: string[] = [];
    for (const other of personas) {
      if (other.id === persona.id) continue;
      const rule = persona.visibilityDefaults[other.nameSlug];
      if (rule !== "n") row.push(other.id);
    }
    matrix[persona.id] = row;
  }
  return matrix;
}

// Recomputes the matrix from the conversation's current personas'
// visibility defaults and writes it to persona_visibility (with the
// conversation.visibility_matrix JSON column dual-written for
// rollback safety). Returns the resulting matrix so callers can
// update their in-memory store snapshot without an extra reload.
export async function rebuildVisibilityFromPersonaDefaults(
  conversationId: string,
): Promise<Record<string, string[]>> {
  const personas = await personasRepo.listPersonas(conversationId);
  const inMemory = computeMatrixFromPersonaDefaults(personas);
  await conversationsRepo.writeVisibilityMatrix(conversationId, inMemory);
  // Re-read from the conversation so the returned matrix matches what
  // any other consumer will see on a subsequent load. The relational
  // round-trip can drop entries the in-memory build emits — e.g. an
  // observer with all-stale 'n' defaults has nothing to record once
  // slugs are resolved against actual personas.
  const reloaded = await conversationsRepo.getConversation(conversationId);
  const matrix = reloaded?.visibilityMatrix ?? {};
  // Dual-write the legacy JSON column so rollbacks (and any code path
  // that still inspects it) stay coherent until the cleanup migration.
  await db
    .updateTable("conversations")
    .set({ visibility_matrix: JSON.stringify(matrix) })
    .where("id", "=", conversationId)
    .execute();
  return matrix;
}
