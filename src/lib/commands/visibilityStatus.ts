// ------------------------------------------------------------------
// Component: Visibility status formatter
// Responsibility: Classify the current visibility matrix and format
//                 a human-readable status string for //visibility.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

import type { Persona } from "../types";

export function formatVisibilityStatus(
  matrix: Record<string, string[]>,
  personas: readonly Persona[],
): string {
  const keys = Object.keys(matrix);
  if (keys.length === 0) return "visibility: full.";

  const allEmpty = keys.every((k) => {
    const row = matrix[k];
    return row !== undefined && row.length === 0;
  });
  const coversAll = personas.length > 0 && personas.every((p) => keys.includes(p.id));
  if (allEmpty && coversAll) return "visibility: separated.";

  const nameById = new Map(personas.map((p) => [p.id, p.name]));
  const lines = personas.map((p) => {
    const row = matrix[p.id];
    if (row === undefined) return `${p.name}: (full)`;
    if (row.length === 0) return `${p.name}: (none)`;
    return `${p.name}: ${row.map((id) => nameById.get(id) ?? id).join(", ")}`;
  });
  return `visibility:\n${lines.join("\n")}`;
}
