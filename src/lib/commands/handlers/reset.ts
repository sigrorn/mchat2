// ------------------------------------------------------------------
// Component: //reset command handler (#294)
// Responsibility: Roll back the conversation by hiding a tail of
//                 messages. Three modes —
//                   "noop":      do nothing (//reset 0)
//                   "full":      hide every row in the conversation
//                   "snapshot":  hide everything past the Nth-from-last
//                                visible compaction snapshot; the
//                                snapshot block (COMPACTION notice +
//                                its [compacted summary] rows) stays
//                                visible as the new sync-point.
//                 Falls through to "full" when the conversation has
//                 fewer than N visible snapshots, or when count===1
//                 and no snapshots exist at all.
//
//                 Hidden rows keep contributing to per-persona /
//                 per-provider USD spend — //reset is a display +
//                 context op, never a billing op. Personas are stored
//                 in their own table and are untouched.
// Collaborators: lib/persistence/messages.applyReset, transaction.
// ------------------------------------------------------------------

import { transaction } from "@/lib/persistence/transaction";
import { reposFor } from "@/lib/persistence/repoContext";
import type { Message } from "@/lib/types";
import type { CommandContext, CommandResult } from "./types";

export type ResetPayload =
  | { mode: "noop" }
  | { mode: "full" }
  | { mode: "snapshot"; count: number };

// A "snapshot block" = COMPACTION notice + the contiguous run of
// pinned `[compacted summary]` assistant rows that immediately follow
// it (commitCompactionWrites guarantees the block is contiguous and
// no later op can insert into the gap). Returns null when there are
// fewer than `count` visible snapshots.
function findSnapshotBoundary(
  messages: readonly Message[],
  count: number,
): number | null {
  // Walk forward, recording each visible COMPACTION notice. Then pick
  // the Nth-from-last and walk forward again to find the end of its
  // contiguous summary run.
  const noticeIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.hiddenByResetId != null) continue;
    if (m.role === "notice" && m.content === "COMPACTION") {
      noticeIndices.push(i);
    }
  }
  if (noticeIndices.length < count) return null;
  const noticePos = noticeIndices[noticeIndices.length - count]!;
  let lastInBlock = noticePos;
  for (let i = noticePos + 1; i < messages.length; i++) {
    const m = messages[i]!;
    if (
      m.role === "assistant" &&
      m.pinned &&
      m.content.startsWith("[compacted summary]")
    ) {
      lastInBlock = i;
      continue;
    }
    break;
  }
  return messages[lastInBlock]!.index;
}

export async function handleReset(
  ctx: CommandContext,
  payload: ResetPayload,
): Promise<CommandResult | void> {
  const { conversation } = ctx;
  if (payload.mode === "noop") {
    await ctx.deps.appendNotice(conversation.id, "reset: nothing to reset.");
    return;
  }
  const history = ctx.deps.getMessages(conversation.id);
  // -1 = "hide everything in the conversation" (no row has idx > -1
  // unless it has idx >= 0, which is every row).
  let boundary = -1;
  let label = "full";
  if (payload.mode === "snapshot") {
    const found = findSnapshotBoundary(history, payload.count);
    if (found !== null) {
      boundary = found;
      label =
        payload.count === 1
          ? "to last snapshot"
          : `${payload.count} snapshots back`;
    } else {
      // Fall through to full — no snapshot at this depth.
      label = "full (no matching snapshot)";
    }
  }
  const result = await transaction(async (txn) => {
    const repos = reposFor(txn.db);
    return repos.messages.applyReset(conversation.id, boundary);
  });
  await ctx.deps.reloadMessages(conversation.id);
  if (result.hiddenCount === 0) {
    await ctx.deps.appendNotice(
      conversation.id,
      `reset: nothing to hide (${label}).`,
    );
    return;
  }
  await ctx.deps.appendNotice(
    conversation.id,
    `reset: hid ${result.hiddenCount} message${result.hiddenCount === 1 ? "" : "s"} (${label}). Cost / spend preserved.`,
  );
}
