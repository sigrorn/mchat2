// ------------------------------------------------------------------
// Component: reorderPersonas use case
// Responsibility: Rewrite sort_order on every persona in a conversation
//                 to match a caller-supplied ordering. All writes
//                 commit together in one transaction so a mid-rewrite
//                 failure rolls back to the prior order. Caller is
//                 typically PersonaPanel's @dnd-kit onDragEnd handler
//                 (#273) — the new ordering is the persona-id array
//                 in display order after the drop.
// Collaborators: lib/persistence/personas (updatePersona × moved
//                personas), lib/persistence/repoContext (transaction
//                threading), components/PersonaPanel (UI caller).
// ------------------------------------------------------------------

import { transaction } from "../persistence/transaction";
import { reposFor } from "../persistence/repoContext";

/**
 * Apply `nextOrder` (an array of persona ids in display order) by
 * rewriting sort_order on every persona whose position changed.
 * Personas not present in the supplied ordering are left at their
 * current sort_order — useful when the caller's view is filtered.
 * Ghost ids (ids not present in the conversation) are skipped silently.
 *
 * Optimisation: identical ordering is a zero-write no-op. The cheapest
 * acceptable rewrite for a partial reorder rewrites only the moved
 * rows.
 */
export async function reorderPersonas(
  conversationId: string,
  nextOrder: readonly string[],
): Promise<void> {
  await transaction(async (txn) => {
    const repos = reposFor(txn.db);
    const current = await repos.personas.listPersonas(conversationId);
    const byId = new Map(current.map((p) => [p.id, p] as const));

    // Filter out ghost ids (id supplied but persona doesn't exist /
    // isn't in this conversation). Caller may race against a delete.
    const validNext = nextOrder.filter((id) => byId.has(id));

    // For each id in the new ordering, the desired sort_order is its
    // index. We use 0..N-1 (no stride) — the rewrite is full for
    // moved rows, so a stride would only matter if we were doing
    // partial-list patches, which we aren't.
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < validNext.length; i++) {
      const id = validNext[i]!;
      const persona = byId.get(id)!;
      if (persona.sortOrder === i) continue;
      writes.push(repos.personas.updatePersona({ ...persona, sortOrder: i }));
    }
    // Sequential await so a mid-rewrite throw rolls back atomically;
    // Promise.all would still see ROLLBACK on throw but the
    // transaction body's contract is one-await-at-a-time inside #267's
    // section-token model.
    for (const w of writes) await w;
  });
}
