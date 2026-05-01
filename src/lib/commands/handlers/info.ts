// ------------------------------------------------------------------
// Component: Info command handlers
// Responsibility: //help, //personas, //stats, //version.
//                 Read-only commands that append a notice describing
//                 some aspect of the current conversation.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { formatPersonasInfo } from "@/lib/commands/personasInfo";
import { formatStats } from "@/lib/commands/stats";
import { triggerHelp } from "@/lib/commands/triggerHelp";
import { logBuffer } from "@/lib/observability/logBuffer";
import { formatLogSnapshot } from "@/lib/observability/format";
import type { CommandContext, CommandResult } from "./types";

export async function handleHelp(ctx: CommandContext): Promise<CommandResult | void> {
  // #237: dedup against the last visible row. Repeated //help (or a
  // mix of //help and the //<TAB> shortcut from #238) emits the help
  // notice once until something else lands in the chat.
  await triggerHelp(ctx.deps, ctx.conversation.id);
}

export async function handlePersonas(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  const messages = ctx.deps.getMessages(conversation.id);
  await ctx.deps.appendNotice(conversation.id, formatPersonasInfo([...personas], [...messages]));
}

export async function handleStats(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  const messages = ctx.deps.getMessages(conversation.id);
  await ctx.deps.appendNotice(
    conversation.id,
    formatStats(conversation, [...messages], [...personas]),
  );
}

export async function handleVersion(ctx: CommandContext): Promise<CommandResult | void> {
  await ctx.deps.appendNotice(
    ctx.conversation.id,
    `mchat2 v${__BUILD_INFO__.version} (${__BUILD_INFO__.commitDate})\ncommit ${__BUILD_INFO__.commitHash}\n${__BUILD_INFO__.commitMessage}`,
  );
}

export async function handleLog(
  ctx: CommandContext,
  payload: { limit: number; clear: boolean },
): Promise<CommandResult | void> {
  if (payload.clear) {
    logBuffer.clear();
    await ctx.deps.appendNotice(ctx.conversation.id, "log: cleared.");
    return;
  }
  const snapshot = logBuffer.snapshot({ limit: payload.limit });
  await ctx.deps.appendNotice(
    ctx.conversation.id,
    formatLogSnapshot(snapshot, payload.limit),
  );
}
