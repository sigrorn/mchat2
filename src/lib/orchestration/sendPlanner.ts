// ------------------------------------------------------------------
// Component: Send planner
// Responsibility: Turn a resolved set of PersonaTargets + active
//                 personas into a SendPlan (single | parallel | dag).
//                 DAG is built only when the user's intent spans
//                 personas that have runsAfter relationships.
// Collaborators: personas/resolver.ts, orchestration/dagExecutor.ts.
// ------------------------------------------------------------------

import type {
  DagNode,
  DagPlan,
  Persona,
  PersonaTarget,
  ResolveMode,
  SendPlan,
} from "../types";

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
  const { mode, targets } = input;
  if (targets.length === 0) return null;
  if (targets.length === 1) {
    const t = targets[0];
    if (!t) return null;
    return { kind: "single", target: t };
  }
  const honorsDag = mode === "all" || mode === "implicit";
  if (!honorsDag) return { kind: "parallel", targets };
  const plan = buildDag(targets, input.personas, input.runId);
  if (plan.nodes.size === 0) return null;
  const anyEdges = [...plan.nodes.values()].some((n) => n.parent !== null);
  if (!anyEdges) return { kind: "parallel", targets };
  return { kind: "dag", plan };
}

// Build the induced subgraph: only edges between selected personas
// count. A persona whose parent is outside the selection becomes a root
// in this DAG (edges out of the subgraph are ignored).
function buildDag(targets: PersonaTarget[], personas: Persona[], runId: number): DagPlan {
  const selectedKeys = new Set(targets.map((t) => t.key));
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  const nodes = new Map<string, DagNode>();

  for (const t of targets) {
    let parent: string | null = null;
    if (t.personaId) {
      const p = personaById.get(t.personaId);
      if (p?.runsAfter) {
        const parentKey = p.runsAfter;
        if (selectedKeys.has(parentKey)) parent = parentKey;
      }
    }
    nodes.set(t.key, {
      key: t.key,
      target: t,
      parent,
      children: [],
      status: "pending",
    });
  }

  for (const n of nodes.values()) {
    if (n.parent) {
      const p = nodes.get(n.parent);
      if (p) p.children.push(n.key);
    }
  }

  const roots = [...nodes.values()].filter((n) => n.parent === null).map((n) => n.key);
  return { runId, nodes, roots };
}
