// ------------------------------------------------------------------
// Component: Conversation compaction
// Responsibility: Generate per-persona summaries of the conversation
//                 so far, to reduce token usage for future sends.
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

export async function generateCompactionSummary(
  adapter: ProviderAdapter,
  apiKey: string | null,
  model: string,
  contextMessages: ChatMessage[],
  extraConfig?: Record<string, unknown>,
): Promise<string> {
  const streamId = `compact:${Date.now()}`;
  let accumulated = "";
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
  })) {
    if (e.type === "token") accumulated += e.text;
    if (e.type === "error") throw new Error(e.message ?? "compaction failed");
    if (e.type === "cancelled") throw new Error("compaction cancelled");
  }
  return accumulated.trim();
}
