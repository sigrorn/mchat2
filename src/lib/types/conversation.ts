// ------------------------------------------------------------------
// Component: Conversation type
// Responsibility: Top-level chat session metadata
// Collaborators: persistence/conversations.ts, stores, UI
// ------------------------------------------------------------------

import type { ProviderId } from "./providers";

export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string | null;
  createdAt: number;
  // Last provider the user sent to; drives default selection on reopen.
  lastProvider: ProviderId | null;
  // Conversation-level context controls.
  // limitMarkIndex: messages with index < mark are excluded unless
  // pinned (and subject to persona filter for assistant pins).
  // null = no limit; 0 = keep everything (semantically same but kept
  // separate for telemetry).
  limitMarkIndex: number | null;
  // Current display mode for multi-target sends.
  displayMode: "lines" | "cols";
  // Visibility mode: "separated" = personas see only their own history
  // and user messages; "joined" = personas see all assistant output too.
  // The visibility matrix layered on top can further restrict.
  visibilityMode: "separated" | "joined";
  // Per-persona visibility matrix (#52). Maps an observer persona id to
  // the list of source persona ids whose assistant rows the observer may
  // see. Semantics:
  //   Missing key → full visibility (observer sees everyone).
  //   Empty array → isolated (observer sees only its own replies).
  //   Non-empty   → observer sees only listed sources + self.
  // Stored as a JSON string in the DB; deserialized on load.
  visibilityMatrix: Record<string, string[]>;
  // Sliding token-budget limit (#64). When set, buildContext truncates
  // to min(limitSizeTokens, provider.maxContextTokens). null = no
  // override (use provider defaults only).
  limitSizeTokens: number | null;
  // Persisted persona selection (#65). Stores the selected persona keys
  // so the selection survives restarts. Empty array = nothing selected.
  selectedPersonas: string[];
  // #102: hard lower bound set by //compact. Messages with index below
  // this are excluded from context and cannot be reached by //limit.
  // null = no floor.
  compactionFloorIndex: number | null;
}
