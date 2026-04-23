// ------------------------------------------------------------------
// Component: History command handlers
// Responsibility: //limit, //retry, //pop, //edit. Operations that
//                 navigate or modify the existing message history of
//                 the current conversation.
// Collaborators: lib/commands/dispatch.ts (dispatcher).
// ------------------------------------------------------------------

import { useMessagesStore } from "@/stores/messagesStore";
import { useConversationsStore } from "@/stores/conversationsStore";
import { indexByUserNumber, userMessageCount } from "@/lib/conversations/userMessageNumber";
import { resolveEditTarget } from "@/lib/conversations/resolveEditTarget";
import { planPop } from "@/lib/conversations/popPlan";
import { findFailedRowsInLastGroup } from "@/lib/orchestration/findFailedRowsInLastGroup";
import * as messagesRepo from "@/lib/persistence/messages";
import type { CommandContext, CommandResult } from "./types";

export async function handleLimit(
  ctx: CommandContext,
  payload: { userNumber: number | null },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  const floor = conversation.compactionFloorIndex;
  const target = payload.userNumber;
  if (target === null) {
    // //limit NONE — clear both fixed limit and limitsize.
    // #102: clamp to compaction floor if one exists.
    await useConversationsStore.getState().setLimit(conversation.id, floor);
    await useConversationsStore.getState().setLimitSize(conversation.id, null);
    return;
  }
  if (target === 0) {
    // #51: //limit 0 — hide every current message. Set the mark to one
    // past the last index so rule 3 of buildContext filters them all
    // (pinned rows still survive).
    const maxIdx = history.reduce((m, msg) => Math.max(m, msg.index), -1);
    await useConversationsStore.getState().setLimit(conversation.id, maxIdx + 1);
    return;
  }
  const idx = indexByUserNumber(history, target);
  if (idx === null) {
    const total = userMessageCount(history);
    await useMessagesStore
      .getState()
      .appendNotice(
        conversation.id,
        `limit: message ${target} does not exist (conversation has ${total} user message${total === 1 ? "" : "s"}).`,
      );
    return { restoreText: rawInput };
  }
  // #102: clamp to compaction floor.
  const effective = floor !== null && idx < floor ? floor : idx;
  // //limit N clears limitsize (#64 interaction rule).
  await useConversationsStore.getState().setLimit(conversation.id, effective);
  await useConversationsStore.getState().setLimitSize(conversation.id, null);
}

export async function handleRetry(ctx: CommandContext): Promise<CommandResult | void> {
  const { conversation, rawInput, retry } = ctx;
  // #49: batch-retry every failed assistant row in the last send group
  // in parallel.
  const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  const failed = findFailedRowsInLastGroup(history);
  if (failed.length === 0) {
    await useMessagesStore.getState().appendNotice(conversation.id, "retry: nothing to retry.");
    return { restoreText: rawInput };
  }
  const cleanupIds: string[] = [];
  await Promise.all(
    failed.map(async (m) => {
      const r = await retry(m);
      if (r.ok) cleanupIds.push(m.id);
    }),
  );
  for (const id of cleanupIds) {
    await messagesRepo.deleteMessage(id);
  }
  if (cleanupIds.length > 0) await useMessagesStore.getState().load(conversation.id);
}

export async function handlePop(
  ctx: CommandContext,
  payload: { userNumber: number | null },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  if (payload.userNumber !== null) {
    // #91: //pop N — rewind to user message N and sequential replay.
    const startIdx = indexByUserNumber(history, payload.userNumber);
    if (startIdx === null) {
      await useMessagesStore
        .getState()
        .appendNotice(conversation.id, `pop: message ${payload.userNumber} does not exist.`);
      return { restoreText: rawInput };
    }
    const userMsgs = history
      .filter((m) => m.role === "user" && !m.pinned && m.index >= startIdx)
      .sort((a, b) => a.index - b.index);
    if (userMsgs.length === 0) {
      await useMessagesStore.getState().appendNotice(conversation.id, "pop: nothing to pop.");
      return { restoreText: rawInput };
    }
    const queue = userMsgs.map((m) => m.content);
    await messagesRepo.deleteMessagesAfter(conversation.id, startIdx - 1);
    await useMessagesStore.getState().load(conversation.id);
    const first = queue[0] ?? "";
    useMessagesStore.getState().setReplayQueue(conversation.id, queue.slice(1));
    await useMessagesStore
      .getState()
      .appendNotice(
        conversation.id,
        `rewound to message ${payload.userNumber}. ${queue.length} user message${queue.length === 1 ? "" : "s"} to replay. Submit empty to skip.`,
      );
    return { restoreText: first };
  }
  // //pop (no arg) — drop the last user turn.
  const plan = planPop(history);
  if (!plan.ok) {
    await useMessagesStore.getState().appendNotice(conversation.id, "pop: nothing to pop.");
    return { restoreText: rawInput };
  }
  await messagesRepo.deleteMessagesAfter(conversation.id, plan.lastUserIndex - 1);
  await useMessagesStore.getState().load(conversation.id);
  await useMessagesStore
    .getState()
    .appendNotice(
      conversation.id,
      `popped ${plan.deleteIds.length} message${plan.deleteIds.length === 1 ? "" : "s"}.`,
    );
  return { restoreText: plan.restoredText };
}

export async function handleEdit(
  ctx: CommandContext,
  payload: { userNumber: number | null },
): Promise<CommandResult | void> {
  const { conversation, rawInput } = ctx;
  // #47: target the specified user message and open MessageList's
  // inline editor.
  const history = useMessagesStore.getState().byConversation[conversation.id] ?? [];
  const target = resolveEditTarget(history, payload.userNumber);
  if (!target) {
    const total = userMessageCount(history);
    const label = payload.userNumber ?? "last";
    await useMessagesStore
      .getState()
      .appendNotice(
        conversation.id,
        total === 0
          ? "edit: no user message to edit."
          : `edit: message ${label} does not exist (conversation has ${total} user message${total === 1 ? "" : "s"}).`,
      );
    return { restoreText: rawInput };
  }
  useMessagesStore.getState().setEditing(conversation.id, target.id);
}
