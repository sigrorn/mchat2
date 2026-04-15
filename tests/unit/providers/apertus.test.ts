// Apertus adapter URL construction and missing-product-id guard — issue #15.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/http";
import type { SSEEvent } from "@/lib/tauri/http";
import { apertusAdapter } from "@/lib/providers";
import type { StreamEvent } from "@/lib/types";

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

let lastUrl: string | undefined;

function mockSSE(frames: SSEEvent[]) {
  __setImpl({
    async *streamSSE(opts) {
      lastUrl = opts.url;
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
});
afterEach(() => __resetImpl());

describe("apertusAdapter", () => {
  it("builds the Infomaniak chat URL from the per-persona productId", async () => {
    mockSSE([{ event: "message", data: "[DONE]" }]);
    await collect(
      apertusAdapter.stream({
        streamId: "s",
        model: "swiss-ai/Apertus-70B-Instruct-2509",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: "sk-test",
        extraConfig: { productId: "12345" },
      }),
    );
    expect(lastUrl).toBe(
      "https://api.infomaniak.com/2/ai/12345/openai/v1/chat/completions",
    );
  });

  it("emits a non-transient error when productId is missing", async () => {
    mockSSE([]);
    const events = await collect(
      apertusAdapter.stream({
        streamId: "s",
        model: "swiss-ai/Apertus-70B-Instruct-2509",
        messages: [],
        systemPrompt: null,
        apiKey: "sk-test",
        extraConfig: {},
      }),
    );
    expect(events[0]).toMatchObject({ type: "error", transient: false });
    if (events[0]?.type === "error") {
      expect(events[0].message).toMatch(/product/i);
    }
  });

  it("emits a non-transient error when API key is missing (regression)", async () => {
    mockSSE([]);
    const events = await collect(
      apertusAdapter.stream({
        streamId: "s",
        model: "swiss-ai/Apertus-70B-Instruct-2509",
        messages: [],
        systemPrompt: null,
        apiKey: null,
        extraConfig: { productId: "12345" },
      }),
    );
    expect(events[0]).toMatchObject({ type: "error", transient: false });
  });
});
