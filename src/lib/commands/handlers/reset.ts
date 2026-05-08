// ------------------------------------------------------------------
// Component: //reset command handler (#294 — stub)
// Responsibility: Roll back the conversation by hiding a tail of
//                 messages, optionally back to the Nth-from-last
//                 visible compaction snapshot. Cost / spend rollups
//                 are unaffected — //reset never touches billing.
// Collaborators: lib/commands/dispatch.ts, lib/persistence/messages.
// ------------------------------------------------------------------

import type { CommandContext, CommandResult } from "./types";

export type ResetPayload =
  | { mode: "noop" }
  | { mode: "full" }
  | { mode: "snapshot"; count: number };

export async function handleReset(
  _ctx: CommandContext,
  _payload: ResetPayload,
): Promise<CommandResult | void> {
  throw new Error("//reset: not implemented");
}
