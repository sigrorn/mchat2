// ------------------------------------------------------------------
// Component: Anthropic adapter
// Responsibility: Claude Messages API streaming over SSE.
// Collaborators: tauri/http.streamSSE.
// ------------------------------------------------------------------

import type { ProviderAdapter, StreamArgs } from "./adapter";
import type { StreamEvent } from "../types";
import { streamSSE, HttpError } from "../tauri/http";

const URL = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

interface MessageStartEvent {
  type: "message_start";
  message: { usage?: { input_tokens?: number } };
}
interface ContentBlockDelta {
  type: "content_block_delta";
  delta: { type: "text_delta"; text: string };
}
interface MessageDelta {
  type: "message_delta";
  usage?: { output_tokens?: number };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "claude",
  async *stream(args: StreamArgs): AsyncIterable<StreamEvent> {
    if (!args.apiKey) {
      yield nonTransient(args.streamId, "No Anthropic API key configured");
      return;
    }
    const body: Record<string, unknown> = {
      model: args.model,
      max_tokens: 4096,
      stream: true,
      messages: args.messages,
    };
    if (args.systemPrompt) body.system = args.systemPrompt;

    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const opts: Parameters<typeof streamSSE>[0] = {
        url: URL,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": args.apiKey,
          "anthropic-version": VERSION,
          // Tauri's webview has an Origin header, which makes the
          // Anthropic API treat the request as a browser call and
          // enforce CORS. The request still goes through Rust (not the
          // browser), so this header is the documented opt-out.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      };
      if (args.signal) opts.signal = args.signal;
      if (args.idleTimeoutMs) opts.idleTimeoutMs = args.idleTimeoutMs;
      for await (const evt of streamSSE(opts)) {
        if (!evt.data || evt.data === "[DONE]") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const p = parsed as { type?: string };
        if (p.type === "message_start") {
          inputTokens = (parsed as MessageStartEvent).message.usage?.input_tokens ?? 0;
        } else if (p.type === "content_block_delta") {
          const d = (parsed as ContentBlockDelta).delta;
          if (d.type === "text_delta" && d.text) {
            yield { type: "token", streamId: args.streamId, text: d.text };
          }
        } else if (p.type === "message_delta") {
          outputTokens = (parsed as MessageDelta).usage?.output_tokens ?? outputTokens;
        }
      }
    } catch (e) {
      yield errorFrom(args.streamId, e);
      return;
    }
    yield {
      type: "usage",
      streamId: args.streamId,
      input: inputTokens,
      output: outputTokens,
      estimated: false,
    };
    yield { type: "complete", streamId: args.streamId };
  },
};

function errorFrom(streamId: string, e: unknown): StreamEvent {
  if ((e as { name?: string }).name === "AbortError") {
    return { type: "cancelled", streamId };
  }
  if (e instanceof HttpError) {
    const transient = e.status === 429 || e.status === 408 || e.status >= 500;
    return { type: "error", streamId, transient, message: e.message };
  }
  return { type: "error", streamId, transient: true, message: (e as Error).message };
}

function nonTransient(streamId: string, message: string): StreamEvent {
  return { type: "error", streamId, transient: false, message };
}
