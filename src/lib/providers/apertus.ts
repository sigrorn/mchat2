// ------------------------------------------------------------------
// Component: Apertus adapter (issue #15)
// Responsibility: Apertus is hosted by Infomaniak with a per-account
//                 Product-Id embedded in the URL path. Wraps the
//                 OpenAI-compat streaming protocol but builds its
//                 base URL per-call from extraConfig.productId.
// Collaborators: tauri/http.streamSSE, persona's apertusProductId.
// ------------------------------------------------------------------

import type { ProviderAdapter, StreamArgs } from "./adapter";
import type { StreamEvent } from "../types";
import { streamSSE, HttpError } from "../tauri/http";

export const apertusAdapter: ProviderAdapter = {
  id: "apertus",
  async *stream(args: StreamArgs): AsyncIterable<StreamEvent> {
    if (!args.apiKey) {
      yield {
        type: "error",
        streamId: args.streamId,
        transient: false,
        message: "No Apertus API key configured.",
      };
      return;
    }
    const productId =
      typeof args.extraConfig?.productId === "string" ? args.extraConfig.productId.trim() : "";
    if (!productId) {
      yield {
        type: "error",
        streamId: args.streamId,
        transient: false,
        message:
          "Apertus persona is missing a Product-Id. Open the persona editor and supply your Infomaniak Product-Id.",
      };
      return;
    }

    const url = `https://api.infomaniak.com/2/ai/${encodeURIComponent(productId)}/openai/v1/chat/completions`;
    const messages = args.systemPrompt
      ? [{ role: "system", content: args.systemPrompt }, ...args.messages]
      : args.messages;
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
        url,
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${args.apiKey}`,
        },
        body: JSON.stringify(body),
      };
      if (args.signal) opts.signal = args.signal;
      for await (const evt of streamSSE(opts)) {
        if (!evt.data || evt.data === "[DONE]") continue;
        let parsed: {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield { type: "token", streamId: args.streamId, text: delta };
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
      yield {
        type: "error",
        streamId: args.streamId,
        transient: true,
        message: (e as Error).message,
      };
      return;
    }
    yield {
      type: "usage",
      streamId: args.streamId,
      input: inputTokens,
      output: outputTokens,
      estimated: inputTokens === 0 && outputTokens === 0,
    };
    yield { type: "complete", streamId: args.streamId };
  },
};
