// ------------------------------------------------------------------
// Component: Visibility & display command handlers
// Responsibility: //visibility, //visibility status, //visibility
//                 default, //lines, //cols.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { buildMatrixFromDefaults } from "@/lib/personas/service";
import { formatVisibilityStatus } from "@/lib/commands/visibilityStatus";
import type { CommandContext, CommandResult } from "./types";

export async function handleVisibilityStatus(
  ctx: CommandContext,
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  const notice = formatVisibilityStatus(conversation.visibilityMatrix, [...personas]);
  await ctx.deps.appendNotice(conversation.id, notice);
}

export async function handleVisibility(
  ctx: CommandContext,
  payload: { mode: "separated" | "joined" },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  // #52: //visibility separated|joined applies the preset matrix to
  // every current persona and updates visibilityMode.
  const personas = ctx.deps.getPersonas(conversation.id);
  const personaIds = personas.map((p) => p.id);
  await ctx.deps.setVisibilityPreset(conversation.id, payload.mode, personaIds);
  await ctx.deps.appendNotice(
    conversation.id,
    `visibility: switched to ${payload.mode === "joined" ? "full" : payload.mode}.`,
  );
}

export async function handleVisibilityDefault(
  ctx: CommandContext,
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = ctx.deps.getPersonas(conversation.id);
  const matrix = buildMatrixFromDefaults([...personas]);
  await ctx.deps.setVisibilityMatrix(conversation.id, matrix);
  await ctx.deps.appendNotice(conversation.id, "visibility: reset to persona defaults.");
}

export async function handleDisplayMode(
  ctx: CommandContext,
  payload: { mode: "lines" | "cols" },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  await ctx.deps.setDisplayMode(conversation.id, payload.mode);
  await ctx.deps.appendNotice(conversation.id, `display: switched to ${payload.mode}.`);
}
