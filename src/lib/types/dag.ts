// ------------------------------------------------------------------
// Component: SendPlan types
// Responsibility: Top-level send plan discriminated union returned by
//                 the planner.
// History:        Phase B of #241 dropped the DAG kind (and its
//                 supporting DagNode / DagPlan / DagNodeStatus types)
//                 alongside removing the runs_after-driven scheduler.
//                 The file name stays for now to keep the import
//                 surface stable; folded back into a more sensible
//                 home alongside any future ordering work.
// Collaborators: orchestration/sendPlanner.ts.
// ------------------------------------------------------------------

import type { PersonaTarget } from "./persona";

// - "single" : exactly one target.
// - "parallel": multiple targets dispatched flat-parallel.
export type SendPlan =
  | { kind: "single"; target: PersonaTarget }
  | { kind: "parallel"; targets: PersonaTarget[] };
