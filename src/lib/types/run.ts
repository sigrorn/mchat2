// ------------------------------------------------------------------
// Component: Run / RunTarget / Attempt domain types
// Responsibility: First-class state-machine primitives for the
//                 orchestration layer (#174 → #176). A Run groups one
//                 or more RunTargets (one per addressed persona); each
//                 RunTarget carries a sequence of Attempts. Retry and
//                 replay become "append a new Attempt" instead of
//                 deleting the previous row.
// Collaborators: lib/persistence/runs (repo), lib/schemas/runs (zod).
// ------------------------------------------------------------------

export type RunKind = "send" | "retry" | "replay" | "compaction";

export type RunTargetStatus =
  | "queued"
  | "streaming"
  | "complete"
  | "error"
  | "cancelled"
  | "superseded";

// How a Run's new attempts relate to attempts of the prior Run on the
// same target. The discriminated union keeps room for future variants
// (e.g. branch-and-keep-active) without forcing a default-case scan
// at every call site.
export type ReplacementPolicy =
  | { kind: "append" } // initial send — no prior attempts to displace
  | { kind: "supersede" } // retry/replay — previous attempts get superseded_at
  | { kind: "branch" }; // edit-based branching (reserved for later)

export interface Run {
  id: string;
  conversationId: string;
  kind: RunKind;
  replacementPolicy: ReplacementPolicy;
  startedAt: number;
  completedAt: number | null;
  // #215: flow step that produced this run (only set when the run was
  // dispatched as part of a conversation flow). Null otherwise.
  flowStepId: string | null;
  targets: RunTarget[];
}

export interface RunTarget {
  id: string;
  runId: string;
  targetKey: string;
  personaId: string | null;
  provider: string | null;
  model: string | null;
  status: RunTargetStatus;
}

export interface Attempt {
  id: string;
  runTargetId: string;
  sequence: number;
  content: string;
  startedAt: number;
  completedAt: number | null;
  errorMessage: string | null;
  errorTransient: boolean;
  inputTokens: number;
  outputTokens: number;
  ttftMs: number | null;
  streamMs: number | null;
  supersededAt: number | null;
}
