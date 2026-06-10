// ------------------------------------------------------------------
// Component: Persona drag-reorder computation
// Responsibility: Pure math behind PersonaPanel's drag-to-reorder.
//                 Given the current personas and the dragged/target
//                 ids, produce the new id order AND the personas with
//                 their sortOrder renumbered to match the new index.
//                 Extracted from PersonaPanel (#319) so the #273
//                 sortOrder-renumber invariant is unit-testable.
// Collaborators: components/persona/PersonaPanelExpanded (caller),
//                lib/app/reorderPersonas (the persistent write).
// ------------------------------------------------------------------

import type { Persona } from "../types";

export interface PersonaReorder {
  nextOrder: string[];
  reordered: Persona[];
}

// Returns null for a no-op drag (active === over) or when either id is
// not in the list. Otherwise returns the new id order and the personas
// re-sorted with sortOrder bumped to the new array index — crucial
// because MessageList's cols-mode column ordering reads sortOrder
// directly, so a shuffled-array-only result would leave columns stale
// (the bug #273's first ship had).
export function computePersonaReorder(
  personas: readonly Persona[],
  activeId: string,
  overId: string,
): PersonaReorder | null {
  if (activeId === overId) return null;
  const ids = personas.map((p) => p.id);
  const oldIdx = ids.indexOf(activeId);
  const newIdx = ids.indexOf(overId);
  if (oldIdx === -1 || newIdx === -1) return null;
  const nextOrder = [...ids];
  nextOrder.splice(oldIdx, 1);
  nextOrder.splice(newIdx, 0, activeId);
  const idToPersona = new Map(personas.map((p) => [p.id, p]));
  const reordered = nextOrder
    .map((id, i) => {
      const p = idToPersona.get(id);
      return p ? { ...p, sortOrder: i } : undefined;
    })
    .filter((p): p is Persona => p !== undefined);
  return { nextOrder, reordered };
}
