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
}
