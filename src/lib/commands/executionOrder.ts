// ------------------------------------------------------------------
// Component: Execution order formatter
// Responsibility: Describe the DAG execution order in plain text for
//                 the //order command.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

import type { Persona } from "../types";

export function formatExecutionOrder(personas: readonly Persona[]): string {
  if (personas.length === 0) return "order: no personas.";
  const hasEdges = personas.some((p) => p.runsAfter.length > 0);
  if (!hasEdges) return "order: all in parallel.";

  const nameById = new Map(personas.map((p) => [p.id, p.name]));
  const roots = personas.filter((p) => p.runsAfter.length === 0);
  const dependents = personas.filter((p) => p.runsAfter.length > 0);

  const parts: string[] = [];
  if (roots.length > 0) {
    parts.push(`${roots.map((p) => p.name).join(", ")} straight away`);
  }
  for (const p of dependents) {
    const parentNames = p.runsAfter.map((id) => nameById.get(id) ?? id).join(" + ");
    parts.push(`${p.name} after ${parentNames}`);
  }
  return `order: ${parts.join("; ")}.`;
}
