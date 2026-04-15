// ------------------------------------------------------------------
// Component: Message types
// Responsibility: Domain types for chat messages and display modes
// Collaborators: context/builder.ts, persistence/messages.ts, UI components
// ------------------------------------------------------------------

import type { ProviderId } from "./providers";

export type Role = "user" | "assistant" | "system";

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
  createdAt: number;
  // Monotonic conversation-local index used by the context builder
  // for limit marks and persona cutoffs. Assigned by the repository.
  index: number;
  // Error info for failed assistant rows. Null for normal completions.
  errorMessage: string | null;
  errorTransient: boolean;
}
