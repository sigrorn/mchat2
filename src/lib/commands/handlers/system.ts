// ------------------------------------------------------------------
// Component: System command handlers
// Responsibility: //vacuum, //limitsize. Operations that affect the
//                 database or conversation-level budgets.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { sql } from "@/lib/tauri/sql";
import { PROVIDER_REGISTRY } from "@/lib/providers/registry";
import { tightestBudgetNotice } from "@/lib/commands/limitsizeNotice";
import type { CommandContext, CommandResult } from "./types";

export async function handleVacuum(ctx: CommandContext): Promise<CommandResult | void> {
  await sql.execute("VACUUM");
  await ctx.deps.appendNotice(ctx.conversation.id, "database vacuumed.");
}

export async function handleLimitsize(
  ctx: CommandContext,
  payload: { kTokens: number | null },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  // #64: sliding token budget.
  // #105: using limitsize turns autocompact off.
  if (conversation.autocompactThreshold) {
    await ctx.deps.setAutocompact(conversation.id, null);
  }
  const kTokens = payload.kTokens;
  if (kTokens === 0) {
    await ctx.deps.setLimitSize(conversation.id, null);
    await ctx.deps.appendNotice(conversation.id, "limitsize: cleared.");
    return;
  }
  if (kTokens !== null) {
    await ctx.deps.setLimitSize(conversation.id, kTokens * 1000);
    await ctx.deps.appendNotice(
      conversation.id,
      `limitsize: set to ${kTokens}k tokens. Context will be trimmed per provider.`,
    );
    return;
  }
  // kTokens === null → auto-fit to tightest provider.
  const personas = ctx.deps.getPersonas(conversation.id);
  if (personas.length === 0) {
    await ctx.deps.appendNotice(conversation.id, "limitsize: no personas — nothing to fit.");
    return { restoreText: rawInput };
  }
  const notice = tightestBudgetNotice([...personas]);
  if (!notice) {
    await ctx.deps.appendNotice(
      conversation.id,
      "limitsize: all providers have unlimited context.",
    );
    return;
  }
  const tightest = Math.min(
    ...personas.map((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens),
  );
  await ctx.deps.setLimitSize(conversation.id, tightest);
  await ctx.deps.appendNotice(conversation.id, notice);
}
