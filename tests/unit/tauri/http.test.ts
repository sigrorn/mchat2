import { describe, it, expect } from "vitest";
import {
  streamSSE,
  __setImpl,
  __resetImpl,
  __test,
  HttpError,
  readSSEFramesWithIdleTimeout,
} from "@/lib/tauri/http";
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

/**
 * Build a ReadableStreamDefaultReader-shaped mock that yields the given
 * (delay-then-chunk) pairs in sequence, then signals done. `cancel()`
 * flips the reader into a rejected state so the idle-timeout path can
 * observe that the reader was aborted.
 */
function mockReader(
  chunks: Array<{ delayMs: number; bytes?: Uint8Array }>,
): {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  cancelled: () => boolean;
} {
  let cancelled = false;
  let i = 0;
  const reader: ReadableStreamDefaultReader<Uint8Array> = {
    async read() {
      if (cancelled) throw new Error("reader cancelled");
      const step = chunks[i++];
      if (!step) return { value: undefined, done: true } as ReadableStreamReadResult<Uint8Array>;
      await new Promise((r) => setTimeout(r, step.delayMs));
      if (cancelled) throw new Error("reader cancelled");
      if (step.bytes === undefined) {
        return { value: undefined, done: true } as ReadableStreamReadResult<Uint8Array>;
      }
      return { value: step.bytes, done: false } as ReadableStreamReadResult<Uint8Array>;
    },
    async cancel() {
      cancelled = true;
    },
    releaseLock() {},
    get closed() {
      return new Promise<undefined>(() => {});
    },
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  return { reader, cancelled: () => cancelled };
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("readSSEFramesWithIdleTimeout", () => {
  it("throws HttpError 408 with 'timeout' in message when no bytes arrive within window", async () => {
    const { reader, cancelled } = mockReader([{ delayMs: 10_000 }]);
    const iter = readSSEFramesWithIdleTimeout(reader, 30);
    let caught: unknown = null;
    try {
      for await (const _e of iter) {
        void _e;
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(408);
    expect((caught as HttpError).message).toMatch(/timeout/i);
    expect(cancelled()).toBe(true);
  });

  it("resets the idle timer on every chunk", async () => {
    // Three chunks each arriving well inside the window, then done.
    const chunks = [
      { delayMs: 15, bytes: enc("data: one\n\n") },
      { delayMs: 15, bytes: enc("data: two\n\n") },
      { delayMs: 15, bytes: enc("data: three\n\n") },
      { delayMs: 0 }, // done
    ];
    const { reader } = mockReader(chunks);
    const out: SSEEvent[] = [];
    for await (const e of readSSEFramesWithIdleTimeout(reader, 50)) out.push(e);
    expect(out.map((e) => e.data)).toEqual(["one", "two", "three"]);
  });

  it("yields frames normally when bytes arrive inside the window", async () => {
    const { reader } = mockReader([
      { delayMs: 5, bytes: enc("data: hello\n\n") },
      { delayMs: 0 },
    ]);
    const out: SSEEvent[] = [];
    for await (const e of readSSEFramesWithIdleTimeout(reader, 1000)) out.push(e);
    expect(out).toEqual([{ event: "message", data: "hello" }]);
  });

  it("handles CRLF frame boundaries across chunks", async () => {
    const { reader } = mockReader([
      { delayMs: 5, bytes: enc("data: a\r\n") },
      { delayMs: 5, bytes: enc("\r\ndata: b\r\n\r\n") },
      { delayMs: 0 },
    ]);
    const out: SSEEvent[] = [];
    for await (const e of readSSEFramesWithIdleTimeout(reader, 200)) out.push(e);
    expect(out.map((e) => e.data)).toEqual(["a", "b"]);
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
