// ------------------------------------------------------------------
// Component: Provider adapter interface
// Responsibility: Shared adapter contract. Every adapter — mock or real —
//                 converts chat-shaped input to a normalized StreamEvent
//                 iterable. The orchestration layer never sees provider
//                 internals.
// Collaborators: providers/mock.ts, future providers/real-*.ts,
//                orchestration/streamRunner.ts.
// ------------------------------------------------------------------

import type { ProviderId, StreamEvent } from "../types";

// Provider-neutral message shape. Role "system" is attached separately
// via systemPrompt so adapters can place it wherever their API expects.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamArgs {
  // Opaque stream id; adapters echo it back on every emitted event so
  // late events arriving after cancel can be dropped by the runner.
  streamId: string;
  model: string;
  messages: ChatMessage[];
  systemPrompt: string | null;
  // API key read at call time from the keychain. Adapters must not
  // cache it. Mock adapter ignores this.
  apiKey: string | null;
  signal?: AbortSignal;
  // Provider-specific runtime config carried from the resolved
  // persona. Apertus reads .productId; other adapters ignore it.
  extraConfig?: Record<string, unknown>;
  // #124: per-chunk idle timeout for the SSE reader. When > 0, the
  // watchdog aborts a silent stream with a transient 408.
  idleTimeoutMs?: number;
}

export interface ProviderAdapter {
  id: ProviderId;
  stream(args: StreamArgs): AsyncIterable<StreamEvent>;
}
