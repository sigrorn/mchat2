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

  await runOneTarget(deps, {
    conversation,
    target,
    personas: [...personas],
    runId,
    bufferTokens: false,
  });

  await deps.reloadMessages(conversation.id);
  return { ok: true };
}
