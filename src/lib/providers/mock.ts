// ------------------------------------------------------------------
// Component: Mock provider adapter
// Responsibility: Deterministic in-process stream for tests, E2E, and
//                 offline development. Behavior is controlled by
//                 directives in the last user message so tests stay
//                 self-contained.
// Collaborators: providers/adapter.ts, E2E tests, streamRunner.
// ------------------------------------------------------------------

import type { ProviderAdapter, StreamArgs } from "./adapter";
import type { StreamEvent } from "../types";

// Directives a test can place in the user message:
//   [[MOCK: tokens=a|b|c]]       — stream exactly these tokens
//   [[MOCK: error=transient]]    — emit transient error, no tokens
//   [[MOCK: error=permanent]]    — emit non-transient error
//   [[MOCK: delay=50]]           — per-token delay ms (default 0)
// Absent directives default to echoing a short scripted reply.
interface Directives {
  tokens: string[];
  error: "transient" | "permanent" | null;
  delay: number;
  inputTokens: number;
  outputTokens: number;
}

const DIRECTIVE_RE = /\[\[MOCK:\s*([^\]]+)\]\]/;

function parseDirectives(text: string): Directives {
  const d: Directives = {
    tokens: ["Mock ", "response."],
    error: null,
    delay: 0,
    inputTokens: Math.max(1, Math.ceil(text.length / 4)),
    outputTokens: 0,
  };
  const m = DIRECTIVE_RE.exec(text);
  if (!m || !m[1]) return d;
  for (const kv of m[1].split(/\s*,\s*/)) {
    const [k, v] = kv.split("=").map((s) => s.trim());
    if (!k || v === undefined) continue;
    if (k === "tokens") d.tokens = v.split("|");
    else if (k === "error") d.error = v === "transient" ? "transient" : "permanent";
    else if (k === "delay") d.delay = Number(v) || 0;
    else if (k === "input") d.inputTokens = Number(v) || d.inputTokens;
  }
  d.outputTokens = d.tokens.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / 4)), 0);
  return d;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
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

export const mockAdapter: ProviderAdapter = {
  id: "mock",
  async *stream(args: StreamArgs): AsyncIterable<StreamEvent> {
    const { streamId, messages, signal } = args;
    const last = messages[messages.length - 1]?.content ?? "";
    const d = parseDirectives(last);

    if (d.error) {
      yield {
        type: "error",
        streamId,
        transient: d.error === "transient",
        message: `mock ${d.error} error`,
      };
      return;
    }

    try {
      for (const token of d.tokens) {
        if (signal?.aborted) {
          yield { type: "cancelled", streamId };
          return;
        }
        if (d.delay > 0) await sleep(d.delay, signal);
        yield { type: "token", streamId, text: token };
      }
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") {
        yield { type: "cancelled", streamId };
        return;
      }
      throw e;
    }

    yield {
      type: "usage",
      streamId,
      input: d.inputTokens,
      output: d.outputTokens,
      estimated: true,
    };
    yield { type: "complete", streamId };
  },
};
