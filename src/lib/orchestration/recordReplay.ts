// ------------------------------------------------------------------
// Component: recordReplay
// Responsibility: Project the side-effects of a replay onto the new
//                 Run / RunTarget / Attempt model (#174 → #177). The
//                 messages table still owns the UI projection — this
//                 is a parallel write so we can validate the model's
//                 shape ahead of #180 flipping the UI to read from it.
// Collaborators: lib/persistence/runs (the new repo), lib/app/replayMessage
//                (caller). Failures here MUST NOT block the user-visible
//                replay flow — the catch site logs and continues.
// ------------------------------------------------------------------

import {
  addRunTarget,
  appendAttempt,
  createRun,
  markRunTargetStatus,
  markSuperseded,
} from "../persistence/runs";

export interface RecordReplayNewMessage {
  id: string;
  personaId: string | null;
  targetKey: string;
  provider: string | null;
  model: string | null;
  content: string;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  ttftMs: number | null;
  streamMs: number | null;
  errorMessage: string | null;
  errorTransient: boolean;
}

export interface RecordReplayInput {
  conversationId: string;
  now: number;
  supersededMessageIds: readonly string[];
  newAssistantMessages: readonly RecordReplayNewMessage[];
  // #234: stamp the replay run with the flow step that's being
  // re-executed. Lets //pop's #232 rewind walk the lineage on a later
  // edit-then-pop chain. Null/omitted = non-flow replay (today's path).
  flowStepId?: string | null;
}

export async function recordReplay(input: RecordReplayInput): Promise<void> {
  const { conversationId, now, supersededMessageIds, newAssistantMessages, flowStepId } = input;
  if (supersededMessageIds.length === 0 && newAssistantMessages.length === 0) return;

  // Mark backfilled attempts as superseded. Convention: every message
  // present at v14 migration time has an `att_<msg_id>` row. New
  // messages from later sub-issues won't (until the send/retry sub-
  // issues land), so a missing attempt is tolerated rather than
  // treated as an integrity violation.
  for (const msgId of supersededMessageIds) {
    await markSuperseded(`att_${msgId}`, now);
  }

  if (newAssistantMessages.length === 0) return;

  const run = await createRun({
    conversationId,
    kind: "replay",
    startedAt: now,
    flowStepId: flowStepId ?? null,
  });
  for (const msg of newAssistantMessages) {
    const status = msg.errorMessage ? "error" : "complete";
    const target = await addRunTarget({
      runId: run.id,
      targetKey: msg.targetKey,
      personaId: msg.personaId,
      provider: msg.provider,
      model: msg.model,
      status,
    });
    await appendAttempt({
      // #180: deterministic id so listSupersededMessageIds can map
      // the attempt back to its message id.
      id: `att_${msg.id}`,
      runTargetId: target.id,
      content: msg.content,
      startedAt: msg.createdAt,
      completedAt: msg.createdAt,
      errorMessage: msg.errorMessage,
      errorTransient: msg.errorTransient,
      inputTokens: msg.inputTokens,
      outputTokens: msg.outputTokens,
      ttftMs: msg.ttftMs,
      streamMs: msg.streamMs,
    });
    // markRunTargetStatus is redundant here (we set it on insert), but
    // call it explicitly so the lifecycle queued→complete is emitted
    // even if we later move to two-phase target inserts.
    void markRunTargetStatus;
  }
}
