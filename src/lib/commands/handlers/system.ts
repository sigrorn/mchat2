// ------------------------------------------------------------------
// Component: System command handlers
// Responsibility: //vacuum, //limitsize. Operations that affect the
//                 database or conversation-level budgets.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { sql } from "@/lib/tauri/sql";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { tightestBudgetNotice } from "@/lib/commands/limitsizeNotice";
import type { CommandContext, CommandResult } from "./types";

export async function handleVacuum(ctx: CommandContext): Promise<CommandResult | void> {
  await sql.execute("VACUUM");
  await useMessagesStore.getState().appendNotice(ctx.conversation.id, "database vacuumed.");
}

export async function handleLimitsize(
  ctx: CommandContext,
  payload: { kTokens: number | null },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  // #64: sliding token budget.
  // #105: using limitsize turns autocompact off.
  if (conversation.autocompactThreshold) {
    await useConversationsStore.getState().setAutocompact(conversation.id, null);
  }
  const kTokens = payload.kTokens;
  if (kTokens === 0) {
    await useConversationsStore.getState().setLimitSize(conversation.id, null);
    await useMessagesStore.getState().appendNotice(conversation.id, "limitsize: cleared.");
    return;
  }
  if (kTokens !== null) {
    await useConversationsStore.getState().setLimitSize(conversation.id, kTokens * 1000);
    await useMessagesStore
      .getState()
      .appendNotice(
        conversation.id,
        `limitsize: set to ${kTokens}k tokens. Context will be trimmed per provider.`,
      );
    return;
  }
  // kTokens === null → auto-fit to tightest provider.
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  if (personas.length === 0) {
    await useMessagesStore
      .getState()
      .appendNotice(conversation.id, "limitsize: no personas — nothing to fit.");
    return { restoreText: rawInput };
  }
  const notice = tightestBudgetNotice(personas);
  if (!notice) {
    await useMessagesStore
      .getState()
      .appendNotice(conversation.id, "limitsize: all providers have unlimited context.");
    return;
  }
  const tightest = Math.min(
    ...personas.map((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens),
  );
  await useConversationsStore.getState().setLimitSize(conversation.id, tightest);
  await useMessagesStore.getState().appendNotice(conversation.id, notice);
}
