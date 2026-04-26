// #169 phase A — adapter for the openai_compat provider. Reads
// baseUrl, extraHeaders, and apiKey from args.extraConfig (assembled
// by the resolver before the call), so the same adapter handles every
// preset and every custom entry.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/http";
import type { SSEEvent } from "@/lib/tauri/http";
import { openaiCompatTemplatedAdapter } from "@/lib/providers/openaiCompatTemplated";
import type { StreamEvent } from "@/lib/types";

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

let lastUrl: string | undefined;
let lastHeaders: Record<string, string> | undefined;
let lastBody: string | undefined;

function mockSSE(frames: SSEEvent[]) {
  __setImpl({
    async *streamSSE(opts) {
      lastUrl = opts.url;
      lastHeaders = opts.headers as Record<string, string>;
      lastBody = typeof opts.body === "string" ? opts.body : undefined;
      for (const f of frames) yield f;
    },
    async request(opts) {
      lastUrl = opts.url;
      return { status: 200, headers: {}, body: "" };
    },
  });
}

beforeEach(() => {
  lastUrl = undefined;
  lastHeaders = undefined;
  lastBody = undefined;
});
afterEach(() => __resetImpl());

describe("openaiCompatTemplatedAdapter", () => {
  it("uses the resolved URL from extraConfig.url", async () => {
    mockSSE([{ event: "message", data: "[DONE]" }]);
    await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "moonshotai/kimi-k2.6",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
        extraConfig: {
          url: "https://openrouter.ai/api/v1/chat/completions",
        },
      }),
    );
    expect(lastUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("merges extraConfig.extraHeaders on top of the standard auth + content-type", async () => {
    mockSSE([{ event: "message", data: "[DONE]" }]);
    await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "x",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
        extraConfig: {
          url: "https://openrouter.ai/api/v1/chat/completions",
          extraHeaders: {
            "HTTP-Referer": "https://mchat2.local",
            "X-Title": "mchat2",
          },
        },
      }),
    );
    expect(lastHeaders?.authorization).toBe("Bearer sk-test");
    expect(lastHeaders?.["content-type"]).toBe("application/json");
    expect(lastHeaders?.["HTTP-Referer"]).toBe("https://mchat2.local");
    expect(lastHeaders?.["X-Title"]).toBe("mchat2");
  });

  it("emits a non-transient error when the URL is missing in extraConfig", async () => {
    mockSSE([]);
    const events = await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "x",
        messages: [],
        systemPrompt: null,
        apiKey: "sk-test",
        extraConfig: {},
      }),
    );
    expect(events[0]).toMatchObject({ type: "error", transient: false });
    if (events[0]?.type === "error") {
      expect(events[0].message).toMatch(/url/i);
    }
  });

  it("emits a non-transient error when API key is missing and the preset requires one", async () => {
    mockSSE([]);
    const events = await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "x",
        messages: [],
        systemPrompt: null,
        apiKey: null,
        extraConfig: {
          url: "https://openrouter.ai/api/v1/chat/completions",
          requiresKey: true,
        },
      }),
    );
    expect(events[0]).toMatchObject({ type: "error", transient: false });
  });

  it("allows missing API key when extraConfig.requiresKey is explicitly false (e.g. local Ollama)", async () => {
    mockSSE([{ event: "message", data: "[DONE]" }]);
    const events = await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "llama3.1:70b",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: null,
        extraConfig: {
          url: "http://localhost:11434/v1/chat/completions",
          requiresKey: false,
        },
      }),
    );
    // No error event up front — Ollama-style endpoints accept missing key.
    expect(events[0]?.type).not.toBe("error");
    expect(lastUrl).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("opts into stream_options.include_usage by default", async () => {
    mockSSE([{ event: "message", data: "[DONE]" }]);
    await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "x",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
        extraConfig: { url: "https://openrouter.ai/api/v1/chat/completions" },
      }),
    );
    const body = JSON.parse(lastBody ?? "{}") as {
      stream_options?: { include_usage?: boolean };
    };
    expect(body.stream_options?.include_usage).toBe(true);
  });

  it("omits stream_options.include_usage when extraConfig.supportsUsageStream is false", async () => {
    // Vanilla TGI / older Ollama don't honor it — passing it harmlessly
    // is fine for most servers, but some refuse the request entirely,
    // so the resolver lets a preset disable the field.
    mockSSE([{ event: "message", data: "[DONE]" }]);
    await collect(
      openaiCompatTemplatedAdapter.stream({
        streamId: "s",
        model: "x",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: null,
        extraConfig: {
          url: "http://localhost:8080/v1/chat/completions",
          requiresKey: false,
          supportsUsageStream: false,
        },
      }),
    );
    const body = JSON.parse(lastBody ?? "{}") as {
      stream_options?: { include_usage?: boolean };
    };
    expect(body.stream_options).toBeUndefined();
  });
});
