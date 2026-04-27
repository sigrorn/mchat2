// ------------------------------------------------------------------
// Component: recordSend
// Responsibility: Project a send's side-effects onto the new
//                 Run/RunTarget/Attempt model (#174 → #179). One Run
//                 per send invocation, one RunTarget per addressed
//                 persona, one Attempt per RunTarget (sequence=1).
//                 Single-target / parallel multi-target / DAG sends
//                 all share this shape — the difference is only the
//                 ordering of newAssistantMessages, which the caller
//                 supplies in execution order.
// Collaborators: lib/persistence/runs (the new repo).
// Tolerated to fail silently — the messages table remains the UI's
// source of truth until #180 flips that.
// ------------------------------------------------------------------

import { addRunTarget, appendAttempt, createRun } from "../persistence/runs";

export interface RecordSendNewMessage {
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

export interface RecordSendInput {
  conversationId: string;
  now: number;
  newAssistantMessages: readonly RecordSendNewMessage[];
}

export async function recordSend(input: RecordSendInput): Promise<void> {
  if (input.newAssistantMessages.length === 0) return;
  const run = await createRun({
    conversationId: input.conversationId,
    kind: "send",
    startedAt: input.now,
  });
  for (const m of input.newAssistantMessages) {
    const target = await addRunTarget({
      runId: run.id,
      targetKey: m.targetKey,
      personaId: m.personaId,
      provider: m.provider,
      model: m.model,
      status: m.errorMessage ? "error" : "complete",
    });
    await appendAttempt({
      // #180: deterministic id so listSupersededMessageIds (which
      // strips the att_ prefix to recover the message id) can map
      // the attempt back to the message it represents.
      id: `att_${m.id}`,
      runTargetId: target.id,
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
  }
}
