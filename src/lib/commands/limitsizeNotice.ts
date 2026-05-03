// ------------------------------------------------------------------
// Component: Limitsize notice builder
// Responsibility: Compute the auto-fit budget and format the notice
//                 string showing which persona(s) are the bottleneck.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

import type { Persona } from "../types";
import { maxContextTokensForPersona } from "../providers/contextWindows";

export function tightestBudgetNotice(personas: readonly Persona[]): string | null {
  if (personas.length === 0) return null;
  const tightest = Math.min(...personas.map(maxContextTokensForPersona));
  if (!Number.isFinite(tightest)) return null;
  const names = personas
    .filter((p) => maxContextTokensForPersona(p) === tightest)
    .map((p) => p.name);
  return `limitsize: auto-set to ${Math.round(tightest / 1000)}k tokens (tightest provider [${names.join(", ")}]).`;
}
