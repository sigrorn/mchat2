// ------------------------------------------------------------------
// Component: User-row header formatter
// Responsibility: Build the header text for a user message bubble:
//                 '[N] user' optionally extended with '→ @name @name'
//                 when the user addressed specific personas.
// Collaborators: components/MessageList.tsx (sole consumer).
// ------------------------------------------------------------------

import type { Persona } from "../types";

export function formatUserHeader(
  userNumber: number | null,
  addressedTo: readonly string[],
  personas: readonly Persona[],
): string {
  const prefix = userNumber !== null ? `[${userNumber}] user` : "user";
  if (addressedTo.length === 0) return `${prefix} \u2192 @all`;
  const names = addressedTo.map((id) => {
    const p = personas.find((x) => x.id === id);
    return p ? `@${p.name}` : `@${id}`;
  });
  return `${prefix} \u2192 ${names.join(" ")}`;
}
