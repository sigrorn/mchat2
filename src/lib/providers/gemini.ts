// ------------------------------------------------------------------
// Component: Gemini adapter
// Responsibility: Google Gemini streamGenerateContent adapter. Uses
//                 'alt=sse' for SSE framing so we can reuse streamSSE.
// Collaborators: tauri/http.streamSSE.
// ------------------------------------------------------------------

import type { ProviderAdapter, StreamArgs } from "./adapter";
import type { StreamEvent } from "../types";
import { streamSSE, HttpError } from "../tauri/http";

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  async *stream(args: StreamArgs): AsyncIterable<StreamEvent> {
    if (!args.apiKey) {
      yield {
        type: "error",
        streamId: args.streamId,
        transient: false,
        message: "No Gemini API key",
      };
      return;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(args.apiKey)}`;
    const contents = args.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const body: Record<string, unknown> = { contents };
    if (args.systemPrompt) {
      body.systemInstruction = { parts: [{ text: args.systemPrompt }] };
    }
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const opts: Parameters<typeof streamSSE>[0] = {
        url,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      };
      if (args.signal) opts.signal = args.signal;
      if (args.idleTimeoutMs) opts.idleTimeoutMs = args.idleTimeoutMs;
      for await (const evt of streamSSE(opts)) {
        if (!evt.data) continue;
        let parsed: GeminiChunk;
        try {
          parsed = JSON.parse(evt.data) as GeminiChunk;
        } catch {
          continue;
        }
        const parts = parsed.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.text) yield { type: "token", streamId: args.streamId, text: part.text };
        }
        if (parsed.usageMetadata) {
          inputTokens = parsed.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = parsed.usageMetadata.candidatesTokenCount ?? outputTokens;
        }
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        yield { type: "cancelled", streamId: args.streamId };
        return;
      }
      if (e instanceof HttpError) {
        const transient = e.status === 429 || e.status === 408 || e.status >= 500;
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
