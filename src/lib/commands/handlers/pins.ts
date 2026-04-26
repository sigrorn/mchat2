// ------------------------------------------------------------------
// Component: Pin command handlers
// Responsibility: //pin, //pins, //unpin, //unpinAll.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { formatPinsNotice } from "@/lib/conversations/pinFormatter";
import { indexByUserNumber } from "@/lib/conversations/userMessageNumber";
import type { CommandContext, CommandResult } from "./types";

export async function handlePin(
  ctx: CommandContext,
  payload: { rest: string },
): Promise<CommandResult | void> {
  const { conversation, rawInput, send } = ctx;
  // Reuse the resolver via useSend with pinned=true. Reject @others
  // up-front since it's contextual and pins need a stable audience.
  if (/^\s*@others\b/i.test(payload.rest)) {
    await ctx.deps.appendNotice(
      conversation.id,
      "pin: @others is not allowed — pins need an explicit, stable audience. Use @name or @all.",
    );
    return { restoreText: rawInput };
  }
  const r = await send(payload.rest, { pinned: true });
  if (!r.ok) {
    await ctx.deps.appendNotice(
      conversation.id,
      r.reason === "no targets"
        ? "pin: specify the target persona(s) before the message body. e.g. //pin @claudio do this."
        : `pin: could not send (${r.reason}).`,
    );
    return { restoreText: rawInput };
  }
}

export async function handlePins(
  ctx: CommandContext,
  payload: { persona: string | null },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  const history = ctx.deps.getMessages(conversation.id);
  const personas = ctx.deps.getPersonas(conversation.id);
  const body = formatPinsNotice([...history], [...personas], payload.persona);
  if (body === null) {
    await ctx.deps.appendNotice(
      conversation.id,
      `pins: persona '${payload.persona ?? ""}' not found.`,
    );
    return { restoreText: rawInput };
  }
  await ctx.deps.appendNotice(conversation.id, body);
}

export async function handleUnpin(
  ctx: CommandContext,
  payload: { userNumber: number },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  const history = ctx.deps.getMessages(conversation.id);
  const idx = indexByUserNumber([...history], payload.userNumber);
  if (idx === null) {
    await ctx.deps.appendNotice(
      conversation.id,
      `unpin: message ${payload.userNumber} does not exist.`,
    );
    return { restoreText: rawInput };
  }
  const target = history.find((m) => m.index === idx);
  if (!target?.pinned) {
    await ctx.deps.appendNotice(
      conversation.id,
      `unpin: message ${payload.userNumber} is not pinned.`,
    );
    return { restoreText: rawInput };
  }
  await ctx.deps.setPinned(conversation.id, target.id, false);
  await ctx.deps.appendNotice(conversation.id, `unpinned message ${payload.userNumber}.`);
}

export async function handleUnpinAll(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const history = ctx.deps.getMessages(conversation.id);
  const pinned = history.filter((m) => m.pinned);
  if (pinned.length === 0) {
    await ctx.deps.appendNotice(conversation.id, "unpin: no pins to remove.");
    return;
  }
  for (const m of pinned) {
    await ctx.deps.setPinned(conversation.id, m.id, false);
  }
  await ctx.deps.appendNotice(
    conversation.id,
    `unpinned ${pinned.length} message${pinned.length === 1 ? "" : "s"}.`,
  );
}
