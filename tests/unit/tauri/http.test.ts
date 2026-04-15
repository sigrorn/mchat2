import { describe, it, expect } from "vitest";
import { streamSSE, __setImpl, __resetImpl, __test } from "@/lib/tauri/http";
import type { SSEEvent } from "@/lib/tauri/http";

describe("parseSSEFrame", () => {
  it("parses data-only frame as message event", () => {
    expect(__test.parseSSEFrame("data: hello")).toEqual({ event: "message", data: "hello" });
  });

  it("joins multi-line data", () => {
    expect(__test.parseSSEFrame("data: a\ndata: b")).toEqual({ event: "message", data: "a\nb" });
  });

  it("parses explicit event type", () => {
    expect(__test.parseSSEFrame("event: delta\ndata: {}")).toEqual({ event: "delta", data: "{}" });
  });

  it("ignores comments and empty data frames", () => {
    expect(__test.parseSSEFrame(":keep-alive\n\n")).toBeNull();
  });
});

describe("streamSSE injection", () => {
  it("delegates to injected impl", async () => {
    const events: SSEEvent[] = [
      { event: "message", data: "one" },
      { event: "message", data: "two" },
    ];
    __setImpl({
      async *streamSSE() {
        for (const e of events) yield e;
      },
      request: async () => ({ status: 200, headers: {}, body: "" }),
    });
    const collected: SSEEvent[] = [];
    for await (const e of streamSSE({ url: "x" })) collected.push(e);
    expect(collected).toEqual(events);
    __resetImpl();
  });
});
