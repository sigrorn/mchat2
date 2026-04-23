// ------------------------------------------------------------------
// Component: Info command handlers
// Responsibility: //help, //personas, //stats, //order, //version.
//                 Read-only commands that append a notice describing
//                 some aspect of the current conversation.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { formatHelp } from "@/lib/commands/help";
import { formatPersonasInfo } from "@/lib/commands/personasInfo";
import { formatStats } from "@/lib/commands/stats";
import { formatExecutionOrder } from "@/lib/commands/executionOrder";
import type { CommandContext, CommandResult } from "./types";

export async function handleHelp(ctx: CommandContext): Promise<CommandResult | void> {
  await useMessagesStore.getState().appendNotice(ctx.conversation.id, formatHelp());
}

export async function handlePersonas(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  const messages = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  await useMessagesStore
    .getState()
    .appendNotice(conversation.id, formatPersonasInfo(personas, messages));
}

export async function handleStats(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  const messages = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  await useMessagesStore
    .getState()
    .appendNotice(conversation.id, formatStats(conversation, messages, personas));
}

export async function handleOrder(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  await useMessagesStore
    .getState()
    .appendNotice(conversation.id, formatExecutionOrder(personas));
}

export async function handleVersion(ctx: CommandContext): Promise<CommandResult | void> {
  await useMessagesStore
    .getState()
    .appendNotice(
      ctx.conversation.id,
      `mchat2 v${__BUILD_INFO__.version} (${__BUILD_INFO__.commitDate})\ncommit ${__BUILD_INFO__.commitHash}\n${__BUILD_INFO__.commitMessage}`,
    );
}
