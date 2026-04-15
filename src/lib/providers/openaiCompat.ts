// ------------------------------------------------------------------
// Component: OpenAI-compatible adapter factory
// Responsibility: Shared streaming implementation for OpenAI-style
//                 chat-completions APIs. Used directly for OpenAI and
//                 parameterized for Perplexity, Mistral, and any
//                 future OpenAI-compatible endpoint.
// Collaborators: tauri/http.streamSSE.
// ------------------------------------------------------------------

import type { ProviderAdapter, StreamArgs } from "./adapter";
import type { ProviderId, StreamEvent } from "../types";
import { streamSSE, HttpError } from "../tauri/http";

export interface OpenAICompatConfig {
  id: ProviderId;
  url: string;
  // Extra headers beyond Authorization + content-type.
  headers?: Record<string, string>;
}

interface Delta {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createOpenAICompatAdapter(cfg: OpenAICompatConfig): ProviderAdapter {
  return {
    id: cfg.id,
    async *stream(args: StreamArgs): AsyncIterable<StreamEvent> {
      if (!args.apiKey) {
        yield { type: "error", streamId: args.streamId, transient: false, message: `No ${cfg.id} API key` };
        return;
      }
      const messages = args.systemPrompt
        ? [{ role: "system", content: args.systemPrompt }, ...args.messages]
        : args.messages;
      // stream_options.include_usage opts into a final SSE chunk that
       // carries prompt/completion token counts (#12). Without it,
       // OpenAI-style streams omit usage entirely and we'd have to
       // estimate from message lengths. OpenAI-compat servers that
       // don't recognize the field ignore it harmlessly.
      const body = {
        model: args.model,
        stream: true,
        stream_options: { include_usage: true },
        messages,
      };
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const opts: Parameters<typeof streamSSE>[0] = {
          url: cfg.url,
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${args.apiKey}`,
            ...cfg.headers,
          },
          body: JSON.stringify(body),
        };
        if (args.signal) opts.signal = args.signal;
        for await (const evt of streamSSE(opts)) {
          if (!evt.data || evt.data === "[DONE]") continue;
          let parsed: Delta;
          try {
            parsed = JSON.parse(evt.data) as Delta;
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { type: "token", streamId: args.streamId, text: delta };
          }
          if (parsed.usage) {
            inputTokens = parsed.usage.prompt_tokens ?? inputTokens;
            outputTokens = parsed.usage.completion_tokens ?? outputTokens;
          }
        }
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") {
          yield { type: "cancelled", streamId: args.streamId };
          return;
        }
        if (e instanceof HttpError) {
          const transient = e.status === 429 || e.status >= 500;
          yield { type: "error", streamId: args.streamId, transient, message: e.message };
          return;
        }
        yield { type: "error", streamId: args.streamId, transient: true, message: (e as Error).message };
        return;
      }
      yield {
        type: "usage",
        streamId: args.streamId,
        input: inputTokens,
        output: outputTokens,
        // OpenAI-style streaming returns usage only in the final chunk
        // (and not always). Mark estimated if we never saw it.
        estimated: inputTokens === 0 && outputTokens === 0,
      };
      yield { type: "complete", streamId: args.streamId };
    },
  };
}

export const openaiAdapter = createOpenAICompatAdapter({
  id: "openai",
  url: "https://api.openai.com/v1/chat/completions",
});

export const perplexityAdapter = createOpenAICompatAdapter({
  id: "perplexity",
  url: "https://api.perplexity.ai/chat/completions",
});

export const mistralAdapter = createOpenAICompatAdapter({
  id: "mistral",
  url: "https://api.mistral.ai/v1/chat/completions",
});

// Apertus is a Swiss-hosted OpenAI-compatible inference endpoint
// (base URL subject to change; revisit when we ship). Stubbed at the
// public-facing shape so the registry compiles end-to-end.
export const apertusAdapter = createOpenAICompatAdapter({
  id: "apertus",
  url: "https://api.apertus.swiss/v1/chat/completions",
});
