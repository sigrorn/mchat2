// ------------------------------------------------------------------
// Component: openai_compat adapter (templated)
// Responsibility: Single adapter for the new openai_compat provider
//                 (#140 → #169). Reads the resolved URL, extra
//                 headers, and capability flags from extraConfig,
//                 which the resolver in extraConfig.ts assembles by
//                 joining the persona's preset selection against the
//                 stored config + keychain. The adapter itself is
//                 preset-agnostic — same code path serves OpenRouter,
//                 OVHcloud, IONOS, Infomaniak, and every custom entry.
// Collaborators: tauri/http.streamSSE, openaiCompatPresets,
//                openaiCompatStorage, providers/extraConfig.
// ------------------------------------------------------------------

import type { ProviderAdapter, StreamArgs } from "./adapter";
import type { StreamEvent } from "../types";
import { streamSSE, HttpError } from "../tauri/http";

interface Delta {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ResolvedConfig {
  url?: unknown;
  extraHeaders?: unknown;
  requiresKey?: unknown;
  supportsUsageStream?: unknown;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asHeaders(v: unknown): Record<string, string> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && val.length > 0) out[k] = val;
  }
  return out;
}

export const openaiCompatTemplatedAdapter: ProviderAdapter = {
  id: "openai_compat",
  async *stream(args: StreamArgs): AsyncIterable<StreamEvent> {
    const cfg = (args.extraConfig ?? {}) as ResolvedConfig;
    const url = asString(cfg.url);
    if (!url) {
      yield {
        type: "error",
        streamId: args.streamId,
        transient: false,
        message:
          "openai_compat persona is missing its endpoint URL. Open Settings · Providers and configure the preset.",
      };
      return;
    }

    // requiresKey defaults true; explicit false (Ollama-style) lets
    // the call go through with no Authorization header.
    const requiresKey = cfg.requiresKey === false ? false : true;
    if (requiresKey && !args.apiKey) {
      yield {
        type: "error",
        streamId: args.streamId,
        transient: false,
        message:
          "openai_compat persona is missing its API key. Open Settings · Providers and supply the key for this preset.",
      };
      return;
    }

    const messages = args.systemPrompt
      ? [{ role: "system" as const, content: args.systemPrompt }, ...args.messages]
      : args.messages;

    // stream_options.include_usage is on by default; presets that
    // know their backend rejects it (vanilla TGI, older Ollama) can
    // opt out via supportsUsageStream === false.
    const supportsUsageStream = cfg.supportsUsageStream === false ? false : true;
    const body: Record<string, unknown> = {
      model: args.model,
      stream: true,
      messages,
    };
    if (supportsUsageStream) body.stream_options = { include_usage: true };

    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...asHeaders(cfg.extraHeaders),
    };
    if (args.apiKey) headers.authorization = `Bearer ${args.apiKey}`;

    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const opts: Parameters<typeof streamSSE>[0] = {
        url,
        method: "POST",
        headers,
        body: JSON.stringify(body),
      };
      if (args.signal) opts.signal = args.signal;
      if (args.idleTimeoutMs) opts.idleTimeoutMs = args.idleTimeoutMs;

      for await (const evt of streamSSE(opts)) {
        if (!evt.data || evt.data === "[DONE]") continue;
        let parsed: Delta;
        try {
          parsed = JSON.parse(evt.data) as Delta;
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
