// ------------------------------------------------------------------
// Component: Send planner
// Responsibility: Turn a resolved set of PersonaTargets + active
//                 personas into a SendPlan (single | parallel | dag).
//                 DAG is built only when the user's intent spans
//                 personas that have runsAfter relationships.
// Collaborators: personas/resolver.ts, orchestration/dagExecutor.ts.
// ------------------------------------------------------------------

import type { DagNode, DagPlan, Persona, PersonaTarget, ResolveMode, SendPlan } from "../types";

export interface PlanSendInput {
  mode: ResolveMode;
  targets: PersonaTarget[];
  // All active personas in the conversation (used to check runsAfter).
  personas: Persona[];
  runId: number;
}

// Targeted and 'others' modes ignore DAG — the user's explicit list is
// exactly what runs, in parallel. 'all' and 'implicit' honor runsAfter.
export function planSend(input: PlanSendInput): SendPlan | null {
  const { mode, personas } = input;
  if (input.targets.length === 0) return null;
  if (input.targets.length === 1) {
    const t = input.targets[0];
    if (!t) return null;
    return { kind: "single", target: t };
  }
  // #117: sort targets by persona.sortOrder for stable display order in
  // multi-persona responses. DAG topological constraints (runsAfter)
  // still take precedence; within a DAG level, sortOrder breaks ties.
  const sortedTargets = sortTargetsBySortOrder(input.targets, personas);
  const honorsDag = mode === "all" || mode === "implicit";
  if (!honorsDag) return { kind: "parallel", targets: sortedTargets };
  const plan = buildDag(sortedTargets, personas, input.runId);
  if (plan.nodes.size === 0) return null;
  const anyEdges = [...plan.nodes.values()].some((n) => n.parents.length > 0);
  if (!anyEdges) return { kind: "parallel", targets: sortedTargets };
  return { kind: "dag", plan };
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

// Build the induced subgraph: only edges between selected personas
// count. A persona whose parent is outside the selection becomes a root
// in this DAG (edges out of the subgraph are ignored).
function buildDag(targets: PersonaTarget[], personas: Persona[], runId: number): DagPlan {
  const selectedKeys = new Set(targets.map((t) => t.key));
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  const nodes = new Map<string, DagNode>();

  for (const t of targets) {
    const parents: string[] = [];
    if (t.personaId) {
      const p = personaById.get(t.personaId);
      if (p) {
        for (const parentId of p.runsAfter) {
          if (selectedKeys.has(parentId)) parents.push(parentId);
        }
      }
    }
    nodes.set(t.key, {
      key: t.key,
      target: t,
      parents,
      children: [],
      status: "pending",
    });
  }

  for (const n of nodes.values()) {
    for (const pk of n.parents) {
      const p = nodes.get(pk);
      if (p) p.children.push(n.key);
    }
  }

  const roots = [...nodes.values()].filter((n) => n.parents.length === 0).map((n) => n.key);
  return { runId, nodes, roots };
}
