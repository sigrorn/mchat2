// ------------------------------------------------------------------
// Component: Pin formatter
// Responsibility: Render the //pins notice body. Pure so the persona
//                 lookup and the user-number assignment are testable
//                 without React.
// Collaborators: components/Composer.tsx (//pins handler).
// ------------------------------------------------------------------

import type { Message, Persona } from "../types";
import { userNumberByIndex } from "./userMessageNumber";
import { slugify } from "../personas/slug";

// Returns the formatted notice body, or null if the persona name is
// supplied but matches no active persona (caller emits an error).
export function formatPinsNotice(
  messages: readonly Message[],
  personas: readonly Persona[],
  filterPersonaName: string | null,
): string | null {
  let filterId: string | null = null;
  if (filterPersonaName !== null) {
    const slug = slugify(filterPersonaName);
    const match = personas.find((p) => p.nameSlug === slug);
    if (!match) return null;
    filterId = match.id;
  }
  const userNumbers = userNumberByIndex(messages);
  const personaById = new Map(personas.map((p) => [p.id, p] as const));

  const pinned = messages.filter((m) => m.pinned);
  const lines: string[] = [];
  for (const m of pinned) {
    if (filterId !== null && !pinAddresses(m, filterId)) continue;
    const n = userNumbers.get(m.index);
    const numLabel = n !== undefined ? `[${n}] ` : "";
    const targets = pinTargetLabel(m, personaById);
    lines.push(`${numLabel}${targets}: ${m.content}`);
  }
  if (lines.length === 0) {
    return filterPersonaName === null
      ? "no pinned messages in this conversation."
      : `no pinned messages addressed to ${filterPersonaName}.`;
  }
  return ["Pinned messages:", ...lines].join("\n");
}

function pinAddresses(m: Message, personaId: string): boolean {
  if (m.pinTarget === personaId) return true;
  if (m.addressedTo.includes(personaId)) return true;
  return false;
}

function pinTargetLabel(m: Message, byId: Map<string, Persona>): string {
  // Identity pins use pinTarget; manual pins use addressedTo.
  if (m.pinTarget) {
    const p = byId.get(m.pinTarget);
    return p ? `@${p.name}` : `@${m.pinTarget}`;
  }
  if (m.addressedTo.length === 0) return "@all";
  return m.addressedTo
    .map((id) => {
      const p = byId.get(id);
      return p ? `@${p.name}` : `@${id}`;
    })
    .join(" ");
}
