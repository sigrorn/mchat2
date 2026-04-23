// ------------------------------------------------------------------
// Component: Visibility & display command handlers
// Responsibility: //visibility, //visibility status, //visibility
//                 default, //lines, //cols.
// Collaborators: lib/commands/dispatch.ts.
// ------------------------------------------------------------------

import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { buildMatrixFromDefaults } from "@/lib/personas/service";
import { formatVisibilityStatus } from "@/lib/commands/visibilityStatus";
import type { CommandContext, CommandResult } from "./types";

export async function handleVisibilityStatus(
  ctx: CommandContext,
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  const notice = formatVisibilityStatus(conversation.visibilityMatrix, personas);
  await useMessagesStore.getState().appendNotice(conversation.id, notice);
}

export async function handleVisibility(
  ctx: CommandContext,
  payload: { mode: "separated" | "joined" },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  // #52: //visibility separated|joined applies the preset matrix to
  // every current persona and updates visibilityMode.
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  const personaIds = personas.map((p) => p.id);
  await useConversationsStore
    .getState()
    .setVisibilityPreset(conversation.id, payload.mode, personaIds);
  await useMessagesStore
    .getState()
    .appendNotice(
      conversation.id,
      `visibility: switched to ${payload.mode === "joined" ? "full" : payload.mode}.`,
    );
}

export async function handleVisibilityDefault(
  ctx: CommandContext,
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  const matrix = buildMatrixFromDefaults(personas);
  await useConversationsStore.getState().setVisibilityMatrix(conversation.id, matrix);
  await useMessagesStore
    .getState()
    .appendNotice(conversation.id, "visibility: reset to persona defaults.");
}

export async function handleDisplayMode(
  ctx: CommandContext,
  payload: { mode: "lines" | "cols" },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  await useConversationsStore.getState().setDisplayMode(conversation.id, payload.mode);
  await useMessagesStore
    .getState()
    .appendNotice(conversation.id, `display: switched to ${payload.mode}.`);
}
