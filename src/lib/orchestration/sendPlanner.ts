// ------------------------------------------------------------------
// Component: Send planner
// Responsibility: Turn a resolved set of PersonaTargets into a
//                 SendPlan (single | parallel). Multi-target sends
//                 dispatch flat-parallel; flow-driven ordering is
//                 handled by flowExecutor (#216) before the planner
//                 ever sees the targets.
// History:        Phase B of #241 removed the runs_after-driven DAG
//                 path. SendPlan still exposes the discriminated union
//                 shape for forward compatibility with future ordering
//                 modes; the "dag" kind is no longer produced.
// Collaborators: personas/resolver.ts, lib/app/runPlannedSend.ts.
// ------------------------------------------------------------------

import type { Persona, PersonaTarget, ResolveMode, SendPlan } from "../types";

export interface PlanSendInput {
  mode: ResolveMode;
  targets: PersonaTarget[];
  // Conversation personas, retained so sortOrder ties stay stable for
  // multi-persona responses.
  personas: Persona[];
  // Run id for the upcoming send. Threaded through to the recordSend
  // path even though the planner itself no longer attaches it to a
  // DAG plan.
  runId: number;
}

export function planSend(input: PlanSendInput): SendPlan | null {
  if (input.targets.length === 0) return null;
  if (input.targets.length === 1) {
    const t = input.targets[0];
    if (!t) return null;
    return { kind: "single", target: t };
  }
  // #117: sort targets by persona.sortOrder for stable display order in
  // multi-persona responses.
  const sortedTargets = sortTargetsBySortOrder(input.targets, input.personas);
  return { kind: "parallel", targets: sortedTargets };
}

// Stable sort: (sortOrder asc, then original index as tiebreaker for
// targets whose persona lookup fails or whose sortOrder collides).
function sortTargetsBySortOrder(
  targets: PersonaTarget[],
  personas: Persona[],
): PersonaTarget[] {
  const sortOrderById = new Map(personas.map((p) => [p.id, p.sortOrder] as const));
  const withIndex = targets.map((t, i) => ({
    t,
    i,
    order: (t.personaId ? sortOrderById.get(t.personaId) : undefined) ?? Number.MAX_SAFE_INTEGER,
  }));
  withIndex.sort((a, b) => a.order - b.order || a.i - b.i);
  return withIndex.map((x) => x.t);
}
