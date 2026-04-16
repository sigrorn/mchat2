import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl, HttpError } from "@/lib/tauri/http";
import type { SSEEvent } from "@/lib/tauri/http";
import { anthropicAdapter, openaiAdapter, geminiAdapter, adapterFor } from "@/lib/providers";
import type { StreamEvent } from "@/lib/types";

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function mockSSE(frames: SSEEvent[]) {
  __setImpl({
    async *streamSSE() {
      for (const f of frames) yield f;
    },
    async request() {
      return { status: 200, headers: {}, body: "" };
    },
  });
}

afterEach(() => __resetImpl());

describe("anthropicAdapter", () => {
  it("parses text_delta events to tokens", async () => {
    mockSSE([
      {
        event: "message_start",
        data: JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10 } } }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Hi " },
        }),
      },
      {
        event: "content_block_delta",
        data: JSON.stringify({
          type: "content_block_delta",
          delta: { type: "text_delta", text: "there" },
        }),
      },
      {
        event: "message_delta",
        data: JSON.stringify({ type: "message_delta", usage: { output_tokens: 2 } }),
      },
    ]);
    const events = await collect(
      anthropicAdapter.stream({
        streamId: "s",
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-ant-test",
      }),
    );
    const tokens = events
      .filter((e) => e.type === "token")
      .map((e) => (e as { text: string }).text);
    expect(tokens).toEqual(["Hi ", "there"]);
    const usage = events.find((e) => e.type === "usage") as { input: number; output: number };
    expect(usage.input).toBe(10);
    expect(usage.output).toBe(2);
    expect(events[events.length - 1]?.type).toBe("complete");
  });

  it("reports missing key as non-transient error", async () => {
    const events = await collect(
      anthropicAdapter.stream({
        streamId: "s",
        model: "claude-sonnet-4-6",
        messages: [],
        systemPrompt: null,
        apiKey: null,
      }),
    );
    expect(events[0]).toMatchObject({ type: "error", transient: false });
  });
});

describe("openaiAdapter", () => {
  it("parses chat.completion.chunk deltas", async () => {
    mockSSE([
      { event: "message", data: JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }) },
      { event: "message", data: JSON.stringify({ choices: [{ delta: { content: "lo" } }] }) },
      { event: "message", data: "[DONE]" },
    ]);
    const events = await collect(
      openaiAdapter.stream({
        streamId: "s",
        model: "gpt-4o",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: "be kind",
        apiKey: "sk-test",
      }),
    );
    const tokens = events
      .filter((e) => e.type === "token")
      .map((e) => (e as { text: string }).text);
    expect(tokens).toEqual(["Hel", "lo"]);
    expect(events[events.length - 1]?.type).toBe("complete");
  });

  it("maps 429 to transient error", async () => {
    __setImpl({
      async *streamSSE(): AsyncIterable<SSEEvent> {
        throw new HttpError(429, "rate limited");
      },
      async request() {
        return { status: 200, headers: {}, body: "" };
      },
    });
    const events = await collect(
      openaiAdapter.stream({
        streamId: "s",
        model: "gpt-4o",
        messages: [],
        systemPrompt: null,
        apiKey: "sk",
      }),
    );
    expect(events[0]).toMatchObject({ type: "error", transient: true });
  });
});

describe("geminiAdapter", () => {
  it("parses candidates[].content.parts[].text", async () => {
    mockSSE([
      {
        event: "message",
        data: JSON.stringify({ candidates: [{ content: { parts: [{ text: "abc" }] } }] }),
      },
      {
        event: "message",
        data: JSON.stringify({
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        }),
      },
    ]);
    const events = await collect(
      geminiAdapter.stream({
        streamId: "s",
        model: "gemini-1.5-pro",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "AIzakey",
      }),
    );
    expect(events.filter((e) => e.type === "token")).toHaveLength(1);
    const usage = events.find((e) => e.type === "usage") as { input: number; output: number };
    expect(usage.input).toBe(5);
    expect(usage.output).toBe(3);
  });
});

describe("adapterFor", () => {
  it("returns one adapter per registered provider", () => {
    expect(adapterFor("claude").id).toBe("claude");
    expect(adapterFor("openai").id).toBe("openai");
    expect(adapterFor("mock").id).toBe("mock");
  });
});

beforeEach(() => {});
