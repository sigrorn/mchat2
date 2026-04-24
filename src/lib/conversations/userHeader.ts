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
  pinTarget?: string | null,
): string {
  const prefix = userNumber !== null ? `[${userNumber}] user` : "user";
  if (pinTarget) {
    const p = personas.find((x) => x.id === pinTarget);
    return `${prefix} \u2192 @${p ? p.name : pinTarget}`;
  }
  if (addressedTo.length === 0) return `${prefix} \u2192 @all`;
  // #130: when the addressedTo list covers every active persona,
  // render the compact "@all" shorthand instead of naming each one.
  // "Covers" means: size matches AND every active persona id is in
  // the addressedTo set. Only applies for 2+ personas; a single
  // persona keeps its explicit name.
  if (personas.length >= 2 && addressedTo.length === personas.length) {
    const set = new Set(addressedTo);
    if (personas.every((p) => set.has(p.id))) {
      return `${prefix} \u2192 @all`;
    }
  }
  const names = addressedTo.map((id) => {
    const p = personas.find((x) => x.id === id);
    return p ? `@${p.name}` : `@${id}`;
  });
  return `${prefix} \u2192 ${names.join(" ")}`;
}
