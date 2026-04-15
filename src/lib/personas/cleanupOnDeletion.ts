// ------------------------------------------------------------------
// Component: Persona-deletion pin cleanup
// Responsibility: Compute the mutation set required on messages when
//                 a persona is tombstoned, so dangling pins do not
//                 surface in //pins as unresolvable @id strings.
// Collaborators: personas/service.deletePersona, persistence/messages.
// ------------------------------------------------------------------

import type { Message } from "../types";

// One mutation per affected message. Fields are optional so the caller
// can build a single UPDATE per row touching only the columns that
// changed.
export interface PinMutation {
  id: string;
  pinned?: boolean;
  pinTarget?: string | null;
  addressedTo?: string[];
}

export function pinMutationsForDeletion(
  messages: readonly Message[],
  deletedPersonaId: string,
): PinMutation[] {
  const out: PinMutation[] = [];
  for (const m of messages) {
    // Identity pin dominates: addressedTo trimming would be moot because
    // the message ends up unpinned anyway.
    if (m.pinTarget === deletedPersonaId) {
      out.push({ id: m.id, pinned: false, pinTarget: null });
      continue;
    }
    if (!m.pinned) continue;
    if (!m.addressedTo.includes(deletedPersonaId)) continue;
    const next = m.addressedTo.filter((id) => id !== deletedPersonaId);
    if (next.length === 0) {
      // Sole target — pin loses its meaning. Leave addressedTo alone so
      // historical context is preserved; only the pin flag changes.
      out.push({ id: m.id, pinned: false });
    } else {
      out.push({ id: m.id, addressedTo: next });
    }
  }
  return out;
}
