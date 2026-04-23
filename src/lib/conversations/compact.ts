// ------------------------------------------------------------------
// Component: Conversation compaction
// Responsibility: Generate per-persona summaries of the conversation
//                 so far, to reduce token usage for future sends.
//                 Returns streaming timings (#122) so callers can
//                 record TTFT/throughput for the compaction summary
//                 rows alongside normal messages.
// Collaborators: context/builder, providers/adapter, Composer.tsx.
// ------------------------------------------------------------------

import type { ProviderAdapter, ChatMessage } from "../providers/adapter";

const COMPACT_SYSTEM_PROMPT =
  "You are a conversation compactor. Summarize the conversation so far " +
  "into a concise summary that preserves all important context, decisions, " +
  "facts, and ongoing threads. The summary will replace the original " +
  "messages as context for future conversation. Be thorough but concise. " +
  "Write in third person, past tense. Do not include preamble like " +
  '"Here is a summary" — just write the summary directly.';

export interface CompactionSummaryResult {
  summary: string;
  /** Approximate tokens emitted by the model (chars/4 fallback when no usage event). */
  outputTokens: number;
  /** ms from adapter.stream iteration start to first token. Null if no token arrived. */
  ttftMs: number | null;
  /** ms from first token to complete event. Null if either boundary is missing. */
  streamMs: number | null;
}

export async function generateCompactionSummary(
  adapter: ProviderAdapter,
  apiKey: string | null,
  model: string,
  contextMessages: ChatMessage[],
  extraConfig?: Record<string, unknown>,
  idleTimeoutMs?: number,
): Promise<CompactionSummaryResult> {
  const streamId = `compact:${Date.now()}`;
  let accumulated = "";
  let outputTokens = 0;
  let reportedOutputTokens = 0;
  let streamOpenAt: number | null = null;
  let firstTokenAt: number | null = null;
  let completeAt: number | null = null;
  streamOpenAt = Date.now();
  for await (const e of adapter.stream({
    streamId,
    model,
    systemPrompt: COMPACT_SYSTEM_PROMPT,
    apiKey,
    messages: [
      ...contextMessages,
      { role: "user", content: "Now summarize this conversation concisely." },
    ],
    ...(extraConfig ? { extraConfig } : {}),
    ...(idleTimeoutMs && idleTimeoutMs > 0 ? { idleTimeoutMs } : {}),
  })) {
    if (e.type === "token") {
      if (firstTokenAt === null) firstTokenAt = Date.now();
      accumulated += e.text;
    }
    if (e.type === "usage") {
      reportedOutputTokens = e.output;
    }
    if (e.type === "complete") completeAt = Date.now();
    if (e.type === "error") throw new Error(e.message ?? "compaction failed");
    if (e.type === "cancelled") throw new Error("compaction cancelled");
  }
  outputTokens = reportedOutputTokens > 0 ? reportedOutputTokens : Math.ceil(accumulated.length / 4);
  const ttftMs =
    streamOpenAt !== null && firstTokenAt !== null ? firstTokenAt - streamOpenAt : null;
  const streamMs =
    firstTokenAt !== null && completeAt !== null ? completeAt - firstTokenAt : null;
  return {
    summary: accumulated.trim(),
    outputTokens,
    ttftMs: ttftMs !== null && ttftMs >= 0 ? ttftMs : null,
    streamMs: streamMs !== null && streamMs >= 0 ? streamMs : null,
  };
}
