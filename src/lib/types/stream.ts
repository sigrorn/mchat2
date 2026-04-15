// ------------------------------------------------------------------
// Component: StreamEvent
// Responsibility: Normalized event shape emitted by every provider adapter
// Collaborators: providers/*, orchestration/streamRunner.ts, stores/send.ts
// ------------------------------------------------------------------

// streamId enables safe late-event handling: after cancellation or a
// conversation switch, events whose streamId doesn't match the current
// send group are ignored rather than racing into stale UI state.
export type StreamEvent =
  | { type: "token"; streamId: string; text: string }
  | {
      type: "usage";
      streamId: string;
      input: number;
      output: number;
      // True when the adapter had to approximate token counts (no
      // server-reported usage). Cost estimation marks these clearly.
      estimated: boolean;
    }
  | {
      type: "retrying";
      streamId: string;
      attempt: number;
      max: number;
      reason: string;
    }
  | { type: "complete"; streamId: string }
  | {
      type: "error";
      streamId: string;
      // Transient errors (rate limits, 5xx, network) are retryable by the
      // runner. Non-transient errors (auth, 4xx other than 429, malformed
      // request) are surfaced to the user immediately without retry.
      transient: boolean;
      message: string;
    }
  | { type: "cancelled"; streamId: string };

export type StreamEventType = StreamEvent["type"];
