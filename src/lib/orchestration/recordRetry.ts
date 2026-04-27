// ------------------------------------------------------------------
// Component: recordRetry
// Responsibility: Project a retry's side-effects onto the existing
//                 RunTarget (#174 → #178). Unlike replay (which opens
//                 a new Run), a retry is part of the original send's
//                 lineage — a new Attempt joins the same RunTarget
//                 with sequence n+1, and the prior Attempt gets
//                 superseded_at stamped.
// Collaborators: lib/persistence/runs (the new repo).
// Tolerated to fail silently — the messages table remains
// authoritative for the UI until #180 flips that.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";
import { appendAttempt, markRunTargetStatus, markSuperseded } from "../persistence/runs";

export interface RecordRetryNewMessage {
  id: string;
  content: string;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  ttftMs: number | null;
  streamMs: number | null;
  errorMessage: string | null;
  errorTransient: boolean;
}

export interface RecordRetryInput {
  failedMessageId: string;
  now: number;
  newAssistantMessage: RecordRetryNewMessage;
}

export async function recordRetry(input: RecordRetryInput): Promise<void> {
  const targetId = `rt_${input.failedMessageId}`;
  // If the failed message predates v14 (impossible — backfill covered
  // all) OR was created after #175 but before later sub-issues land
  // an Attempt-on-send write path, the target row may not exist. In
  // that case there's nothing to retry-record onto; bail cleanly.
  const targetRows = await sql.select<{ id: string }>(
    "SELECT id FROM run_targets WHERE id = ?",
    [targetId],
  );
  if (targetRows.length === 0) return;

  await markSuperseded(`att_${input.failedMessageId}`, input.now);

  const m = input.newAssistantMessage;
  await appendAttempt({
    // #180: deterministic id so listSupersededMessageIds can map
    // the attempt back to its message id.
    id: `att_${m.id}`,
    runTargetId: targetId,
    content: m.content,
    startedAt: m.createdAt,
    completedAt: m.createdAt,
    errorMessage: m.errorMessage,
    errorTransient: m.errorTransient,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    ttftMs: m.ttftMs,
    streamMs: m.streamMs,
  });

  await markRunTargetStatus(targetId, m.errorMessage ? "error" : "complete");
}
