// ------------------------------------------------------------------
// Component: Message types
// Responsibility: Domain types for chat messages and display modes
// Collaborators: context/builder.ts, persistence/messages.ts, UI components
// ------------------------------------------------------------------

import type { ProviderId } from "./providers";

// 'notice' is a UI-only row: rendered in the chat stream for the user
// but always excluded from context projections. Used for command
// errors and info messages that must never reach an LLM.
export type Role = "user" | "assistant" | "system" | "notice";

// How multi-target assistant output is laid out in the UI.
// "lines" = interleaved, streaming per-token.
// "cols" = side-by-side columns; results buffered until all complete
// (see DAG rules in CLAUDE.md).
export type DisplayMode = "lines" | "cols";

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  // For assistant rows: which provider/model produced it.
  provider: ProviderId | null;
  model: string | null;
  // For assistant rows: opaque persona id (or null if no persona).
  personaId: string | null;
  displayMode: DisplayMode;
  pinned: boolean;
  // If pinned, which persona-key should see it. null = visible to all.
  // Persona key = personaId ?? provider (same rule as visibility filter).
  pinTarget: string | null;
  // For user rows: which personas the user explicitly addressed via
  // @-prefix. Stored as a list of persona keys. Empty = implicit
  // (current selection / all).
  addressedTo: string[];
  // For assistant rows: the audience the response is scoped to —
  // inherited from the user message being responded to. Drives the
  // 'separated' visibility filter. Empty = legacy/implicit; falls
  // back to author-only filtering so pre-v3 rows do not leak.
  audience: string[];
  createdAt: number;
  // Monotonic conversation-local index used by the context builder
  // for limit marks and persona cutoffs. Assigned by the repository.
  index: number;
  // Error info for failed assistant rows. Null for normal completions.
  errorMessage: string | null;
  errorTransient: boolean;
  // Usage accounting populated by streamRunner on completion. Zero on
  // user/system rows and on pre-v2 rows predating the migration.
  inputTokens: number;
  outputTokens: number;
  // True when the adapter had to approximate usage (no server-reported
  // counts). Surfaces via the '~' prefix in cost displays.
  usageEstimated: boolean;
  // #122 — streaming timings, populated by streamRunner on successful
  // completion. Undefined/null for non-streamed rows, failed or
  // cancelled streams, and pre-migration rows. Optional so most call
  // sites (non-streamed row construction) don't need to set them.
  ttftMs?: number | null;
  streamMs?: number | null;
  // #206: when non-null, this message has been replaced by a later
  // replay or retry. The UI filter hides it; the context builder
  // skips it. The row is kept in the messages table so a future
  // attempt-history affordance (#181) can surface it. Null = visible.
  supersededAt?: number | null;
  // #229: when non-null, the user has clicked the confirm checkbox
  // on this notice row and the renderer hides it. Only meaningful
  // for role === "notice" rows; ignored otherwise.
  confirmedAt?: number | null;
}
