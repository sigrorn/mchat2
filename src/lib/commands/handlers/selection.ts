// ------------------------------------------------------------------
// Component: Selection command handlers
// Responsibility: //select, //select ALL. (+/- target modifiers are
//                 NOT command-parsed; see components/Composer.tsx.)
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import type { CommandContext, CommandResult } from "./types";

export async function handleSelectAll(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  const all = personas.map((p) => p.id);
  ctx.deps.setSelection(conversation.id, all);
  const names = personas.map((p) => p.name).join(", ");
  await ctx.deps.appendNotice(conversation.id, `selected: ${names || "(none)"}.`);
}

export async function handleSelect(
  ctx: CommandContext,
  payload: { names: string[] },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const name of payload.names) {
    const match = personas.find((p) => p.nameSlug === name);
    if (match) {
      if (!ids.includes(match.id)) ids.push(match.id);
    } else {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    await ctx.deps.appendNotice(
      conversation.id,
      `select: unknown persona${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}.`,
    );
    return { restoreText: rawInput };
  }
  ctx.deps.setSelection(conversation.id, ids);
  const names = ids.map((id) => personas.find((p) => p.id === id)?.name ?? id).join(", ");
  await ctx.deps.appendNotice(conversation.id, `selected: ${names}.`);
}
