// ------------------------------------------------------------------
// Component: Retry manager
// Responsibility: Wrap any StreamEvent source with exponential-backoff
//                 retry for transient errors. Non-transient errors and
//                 cancellation surface immediately.
// Collaborators: orchestration/streamRunner.ts, providers/adapter.ts.
// ------------------------------------------------------------------

import type { StreamEvent } from "../types";

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 8000,
};

// Take a factory (not a started iterable) because a retry must start
// a fresh stream from the provider, not resume the old one.
export async function* withRetry(
  streamId: string,
  factory: () => AsyncIterable<StreamEvent>,
  policy: RetryPolicy = DEFAULT_RETRY,
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  let attempt = 0;
  let delay = policy.initialDelayMs;
  while (true) {
    attempt++;
    let transientError: { message: string } | null = null;
    for await (const e of factory()) {
      if (e.type === "error" && e.transient && attempt < policy.maxAttempts) {
        transientError = { message: e.message };
        break;
      }
      yield e;
      if (e.type === "complete" || e.type === "cancelled") return;
      if (e.type === "error") return;
    }
    if (!transientError) return;
    yield {
      type: "retrying",
      streamId,
      attempt,
      max: policy.maxAttempts,
      reason: transientError.message,
    };
    await sleep(delay, signal);
    delay = Math.min(policy.maxDelayMs, delay * policy.backoffFactor);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = (): void => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
