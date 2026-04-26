// ------------------------------------------------------------------
// Component: retryMessage (lib/app)
// Responsibility: Re-run streaming for a single failed assistant
//                 message — typically invoked from the in-line "retry"
//                 button on an error row. Smallest of the three send
//                 orchestrations; near-trivial after runOneTarget was
//                 extracted in #148.
// Collaborators: lib/app/runOneTarget, lib/orchestration/retryTarget,
//                hooks/useSend (wires deps).
// ------------------------------------------------------------------

import type { Conversation, Message } from "@/lib/types";
import { buildRetryTarget } from "@/lib/orchestration/retryTarget";
import { recordRetry } from "@/lib/orchestration/recordRetry";
import { runOneTarget } from "./runOneTarget";
import type { RetryMessageDeps } from "./deps";

export type RetryResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function retryMessage(
  deps: RetryMessageDeps,
  args: { conversation: Conversation; failed: Message },
): Promise<RetryResult> {
  const { conversation, failed } = args;
  const personas = deps.getPersonas(conversation.id);
  const target = buildRetryTarget(failed, [...personas]);
  if (!target) return { ok: false, reason: "no retry target" };

  const runId = deps.nextRunId(conversation.id);
  deps.setTargetStatus(conversation.id, target.key, "queued");

  const outcome = await runOneTarget(deps, {
    conversation,
    target,
    personas: [...personas],
    runId,
    bufferTokens: false,
  });

  await deps.reloadMessages(conversation.id);

  // #178: parallel-write the retry's side-effects onto the failed
  // message's RunTarget. Tolerated to fail silently — the messages
  // table remains authoritative until #180 flips that.
  try {
    const newMsg = deps.getMessages(conversation.id).find((m) => m.id === outcome.messageId);
    if (newMsg) {
      await recordRetry({
        failedMessageId: failed.id,
        now: Date.now(),
        newAssistantMessage: {
          id: newMsg.id,
          content: newMsg.content,
          createdAt: newMsg.createdAt,
          inputTokens: newMsg.inputTokens,
          outputTokens: newMsg.outputTokens,
          ttftMs: newMsg.ttftMs ?? null,
          streamMs: newMsg.streamMs ?? null,
          errorMessage: newMsg.errorMessage,
          errorTransient: newMsg.errorTransient,
        },
      });
    }
  } catch (err) {
    console.warn("recordRetry failed (parallel-write; non-fatal)", err);
  }

  return { ok: true };
}
