// ------------------------------------------------------------------
// Component: Compaction command handlers
// Responsibility: //compact, //autocompact. Manual compaction runs
//                 the shared runCompaction; autocompact configures
//                 the per-conversation threshold that postResponseCheck
//                 monitors.
// Collaborators: lib/commands/dispatch.ts,
//                lib/conversations/runCompaction.ts.
// ------------------------------------------------------------------

import type { AutocompactThreshold } from "@/lib/types";
import { useMessagesStore } from "@/stores/messagesStore";
import { usePersonasStore } from "@/stores/personasStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { useSendStore } from "@/stores/sendStore";
import { runCompaction, formatPersonaLine } from "@/lib/conversations/runCompaction";
import { formatStats } from "@/lib/commands/stats";
import type { CommandContext, CommandResult } from "./types";

export async function handleAutocompact(
  ctx: CommandContext,
  payload:
    | { mode: "kTokens"; value: number; preserve?: number }
    | { mode: "percent"; value: number; preserve?: number }
    | { mode: "off" },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  if (payload.mode === "off") {
    await useConversationsStore.getState().setAutocompact(conversation.id, null);
    await useMessagesStore.getState().appendNotice(conversation.id, "autocompact: off.");
    return;
  }
  // Disable limitsize when autocompact is turned on (#105).
  if (conversation.limitSizeTokens !== null) {
    await useConversationsStore.getState().setLimitSize(conversation.id, null);
  }
  const threshold: AutocompactThreshold = {
    mode: payload.mode,
    value: payload.value,
    ...(payload.preserve !== undefined && payload.preserve > 0
      ? { preserve: payload.preserve }
      : {}),
  };
  await useConversationsStore.getState().setAutocompact(conversation.id, threshold);
  const label =
    payload.mode === "kTokens"
      ? `${payload.value}k tokens`
      : `${payload.value}% of tightest model`;
  const preserveSuffix =
    threshold.preserve && threshold.preserve > 0
      ? ` (preserving last ${threshold.preserve} user message${threshold.preserve === 1 ? "" : "s"})`
      : "";
  await useMessagesStore
    .getState()
    .appendNotice(
      conversation.id,
      `autocompact: will compact when context exceeds ${label}${preserveSuffix}. limitsize cleared.`,
    );
}

export async function handleCompact(
  ctx: CommandContext,
  payload: { preserve: number },
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  const personas = usePersonasStore.getState().byConversation[conversation.id] ?? [];
  if (personas.length === 0) {
    await useMessagesStore
      .getState()
      .appendNotice(conversation.id, "compact: no personas to compact.");
    return;
  }
  const preserve = payload.preserve;
  const preserveLabel =
    preserve > 0 ? ` (preserving last ${preserve} user message${preserve === 1 ? "" : "s"})` : "";
  // #122 — emit the current //stats snapshot before compacting so the
  // user can see the TTFT/throughput averages that led up to this run.
  const preMessages = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  await useMessagesStore
    .getState()
    .appendNotice(conversation.id, formatStats(conversation, preMessages, personas));
  await useMessagesStore
    .getState()
    .appendNotice(
      conversation.id,
      `compacting: generating summaries for ${personas.length} persona${personas.length === 1 ? "" : "s"}${preserveLabel}…`,
    );
  const result = await runCompaction(conversation, personas, preserve, {
    onPersonaStart: (pid) =>
      useSendStore.getState().setTargetStatus(conversation.id, pid, "streaming"),
    onPersonaError: (pid) =>
      useSendStore.getState().setTargetStatus(conversation.id, pid, "retrying"),
    onPersonaDone: (pid) => useSendStore.getState().clearTargetStatus(conversation.id, pid),
  });
  for (const f of result.failures) {
    await useMessagesStore
      .getState()
      .appendNotice(conversation.id, `compact: failed for ${f.persona.name}: ${f.error}`);
  }
  if (result.nothingToDo) {
    await useMessagesStore
      .getState()
      .appendNotice(
        conversation.id,
        `compact: nothing to compact (preserve ${preserve} already covers the full unexcluded history).`,
      );
    return;
  }
  if (result.summaries.length === 0) {
    await useMessagesStore
      .getState()
      .appendNotice(conversation.id, "compact: no summaries generated.");
    return;
  }
  await useMessagesStore.getState().load(conversation.id);
  await useConversationsStore.getState().setCompactionFloor(conversation.id, result.cutoff);
  await useConversationsStore.getState().setLimit(conversation.id, result.cutoff);
  const lines = [
    `compacted ${result.summaries.length} persona${result.summaries.length === 1 ? "" : "s"}.`,
  ];
  for (const s of result.summaries) {
    lines.push(formatPersonaLine(s, result.tightestMaxTokens));
  }
  await useMessagesStore.getState().appendNotice(conversation.id, lines.join("\n"));
}
