// ------------------------------------------------------------------
// Component: Types barrel
// Responsibility: Re-export domain types for ergonomic imports
// Collaborators: the rest of lib/ and stores/
// ------------------------------------------------------------------

export type { ProviderId } from "./providers";
export type { Role, DisplayMode, Message } from "./messages";
export type { AutocompactThreshold, Conversation } from "./conversation";
export type { PersonaId, Persona, ResolveMode, PersonaTarget } from "./persona";
export type { StreamEvent, StreamEventType, StreamStatus, ActiveStream } from "./stream";
export type { DagNodeStatus, DagNode, DagPlan, SendPlan } from "./dag";
export type {
  RunKind,
  RunTargetStatus,
  ReplacementPolicy,
  Run,
  RunTarget,
  Attempt,
} from "./run";
export type {
  Flow,
  FlowStep,
  FlowStepKind,
  FlowDraft,
  FlowDraftStep,
} from "./flow";
