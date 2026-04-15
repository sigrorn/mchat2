// OpenAI-compat adapter sends stream_options.include_usage and parses
// the resulting usage chunk — issue #12.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/http";
import type { SSEEvent } from "@/lib/tauri/http";
import { openaiAdapter } from "@/lib/providers";
import type { StreamEvent } from "@/lib/types";

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

let lastBody: unknown;

function mockSSE(frames: SSEEvent[]) {
  __setImpl({
    async *streamSSE(opts) {
      lastBody = opts.body ? JSON.parse(opts.body) : null;
      for (const f of frames) yield f;
    },
    async request() {
      return { status: 200, headers: {}, body: "" };
    },
  });
}

beforeEach(() => {
  lastBody = null;
});
afterEach(() => __resetImpl());

describe("openaiAdapter usage opt-in", () => {
  it("sends stream_options.include_usage=true in the request body", async () => {
    mockSSE([{ event: "message", data: "[DONE]" }]);
    await collect(
      openaiAdapter.stream({
        streamId: "s",
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
      }),
    );
    const body = lastBody as { stream_options?: { include_usage?: boolean } };
    expect(body.stream_options?.include_usage).toBe(true);
  });

  it("when usage chunk arrives, emits a usage event with estimated=false", async () => {
    mockSSE([
      { event: "message", data: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }) },
      {
        event: "message",
        data: JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }),
      },
      { event: "message", data: "[DONE]" },
    ]);
    const events = await collect(
      openaiAdapter.stream({
        streamId: "s",
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
      }),
    );
    const usage = events.find((e) => e.type === "usage") as
      | { input: number; output: number; estimated: boolean }
      | undefined;
    expect(usage).toBeDefined();
    expect(usage?.input).toBe(12);
    expect(usage?.output).toBe(7);
    expect(usage?.estimated).toBe(false);
  });

  it("when no usage chunk arrives, emits estimated=true (regression guard)", async () => {
    mockSSE([
      { event: "message", data: JSON.stringify({ choices: [{ delta: { content: "hi" } }] }) },
      { event: "message", data: "[DONE]" },
    ]);
    const events = await collect(
      openaiAdapter.stream({
        streamId: "s",
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
      }),
    );
    const usage = events.find((e) => e.type === "usage") as
      | { input: number; output: number; estimated: boolean }
      | undefined;
    expect(usage?.estimated).toBe(true);
  });
});
