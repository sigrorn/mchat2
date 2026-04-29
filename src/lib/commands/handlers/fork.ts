// ------------------------------------------------------------------
// Component: //fork command handler
// Responsibility: Branch the current conversation from the user's
//                 chosen cut point into a new conversation. Reads the
//                 source's flow + personas + messages, delegates the
//                 actual cloning to forkConversation, then switches
//                 the UI over to the new conversation. Mirrors the
//                 store-switching shape used by snapshot import in
//                 useConversationExports — fork is its in-app sibling.
// Collaborators: lib/conversations/forkConversation, lib/commands/dispatch.
// ------------------------------------------------------------------

import { forkConversation, ForkRangeError } from "@/lib/conversations/forkConversation";
import type { CommandContext, CommandResult } from "./types";

export async function handleFork(
  ctx: CommandContext,
  payload: { userNumber: number | null },
): Promise<CommandResult | void> {
  const sourceId = ctx.conversation.id;
  const sourceMessages = ctx.deps.getMessages(sourceId);
  const sourcePersonas = ctx.deps.getPersonas(sourceId);
  const sourceFlow = await ctx.deps.getFlow(sourceId);

  let forked;
  try {
    forked = await forkConversation({
      source: ctx.conversation,
      sourcePersonas,
      sourceMessages,
      sourceFlow,
      cutAtUserNumber: payload.userNumber,
    });
  } catch (err) {
    if (err instanceof ForkRangeError) {
      await ctx.deps.appendNotice(sourceId, err.message);
      return { restoreText: ctx.rawInput };
    }
    throw err;
  }

  // Same shape as snapshot import: refresh the conversations list, set
  // the new id as current, then load its personas + messages so the
  // panes update without waiting for a window refresh.
  await ctx.deps.reloadConversations();
  ctx.deps.selectConversation(forked.id);
  await ctx.deps.loadPersonas(forked.id);
  await ctx.deps.loadMessages(forked.id);
  await ctx.deps.appendNotice(forked.id, `forked from "${ctx.conversation.title}".`);
}
