// ------------------------------------------------------------------
// Component: //fork command handler
// Responsibility: Branch the current conversation from the user's
//                 chosen cut point into a new conversation. Stub —
//                 implementation lands in the next commit per the
//                 test-first workflow.
// Collaborators: lib/conversations/forkConversation, lib/commands/dispatch.
// ------------------------------------------------------------------

import type { CommandContext, CommandResult } from "./types";

export async function handleFork(
  _ctx: CommandContext,
  _payload: { userNumber: number | null },
): Promise<CommandResult | void> {
  throw new Error("handleFork: not implemented");
}
