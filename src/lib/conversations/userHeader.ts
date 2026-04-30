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
  // #231: when true, this row was dispatched via the conversation
  // flow path. The header renders '[N] user \u2192 conversation \u2192 @\u2026'
  // so a flow turn is visually distinct from an explicit @a,@b
  // multi-target send (after #227 both look identical in addressedTo).
  flowDispatched?: boolean,
): string {
  const prefix = userNumber !== null ? `[${userNumber}] user` : "user";
  // Pin path is unchanged \u2014 pinTarget short-circuits the flow marker.
  if (pinTarget) {
    const p = personas.find((x) => x.id === pinTarget);
    return `${prefix} \u2192 @${p ? p.name : pinTarget}`;
  }
  // #231: insert the conversation marker before the standard
  // addressedTo formatting so all the existing branches (@all
  // shorthand, explicit list, fallback to id) flow through it.
  const head = flowDispatched ? `${prefix} \u2192 conversation` : prefix;
  if (addressedTo.length === 0) return `${head} \u2192 @all`;
  // #130: when the addressedTo list covers every active persona,
  // render the compact "@all" shorthand instead of naming each one.
  // "Covers" means: size matches AND every active persona id is in
  // the addressedTo set. Only applies for 2+ personas; a single
  // persona keeps its explicit name.
  if (personas.length >= 2 && addressedTo.length === personas.length) {
    const set = new Set(addressedTo);
    if (personas.every((p) => set.has(p.id))) {
      return `${head} \u2192 @all`;
    }
  }
  const names = addressedTo.map((id) => {
    const p = personas.find((x) => x.id === id);
    return p ? `@${p.name}` : `@${id}`;
  });
  return `${head} \u2192 ${names.join(" ")}`;
}
