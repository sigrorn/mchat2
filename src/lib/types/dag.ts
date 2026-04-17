// ------------------------------------------------------------------
// Component: DAG types
// Responsibility: Node status + execution plan shapes
// Collaborators: orchestration/dagExecutor.ts, sendPlanner.ts, stores
// ------------------------------------------------------------------

import type { PersonaTarget } from "./persona";

// pending  : scheduled, not yet started
// running  : stream in flight
// completed: stream finished, assistant row persisted
// failed   : stream errored (transient after retries or non-transient)
// skipped  : ancestor failed OR conversation switched away mid-run
export type DagNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface DagNode {
  // Persona key = personaId ?? provider.
  key: string;
  target: PersonaTarget;
  // Parent keys within the induced subgraph. Empty = root.
  parents: string[];
  // Direct children within the induced subgraph.
  children: string[];
  status: DagNodeStatus;
}

export interface DagPlan {
  // Monotonically increasing per conversation. Retry auto-resume only
  // promotes skipped children if the retry's run_id matches the
  // current run_id.
  runId: number;
  nodes: Map<string, DagNode>;
  // Convenience: keys of all root nodes (parents.length === 0).
  roots: string[];
}

// Top-level send plan discriminated union.
// - "single" : exactly one target, no DAG.
// - "parallel": multiple targets with no active dependencies (targeted
//    sends, @others, or @all with no runsAfter edges).
// - "dag"    : @all or implicit multi-persona with runsAfter edges.
export type SendPlan =
  | { kind: "single"; target: PersonaTarget }
  | { kind: "parallel"; targets: PersonaTarget[] }
  | { kind: "dag"; plan: DagPlan };
