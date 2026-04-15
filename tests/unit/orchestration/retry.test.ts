import { describe, it, expect } from "vitest";
import { withRetry } from "@/lib/orchestration/retryManager";
import type { StreamEvent } from "@/lib/types";

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const fastPolicy = { maxAttempts: 3, initialDelayMs: 1, backoffFactor: 1, maxDelayMs: 2 };

describe("withRetry", () => {
  it("retries on transient error, emits 'retrying', then succeeds", async () => {
    let calls = 0;
    const factory = (): AsyncIterable<StreamEvent> => {
      calls++;
      const attempt = calls;
      return (async function* () {
        if (attempt < 2) {
          yield { type: "error", streamId: "s", transient: true, message: "rate-limited" };
          return;
        }
        yield { type: "token", streamId: "s", text: "hi" };
        yield { type: "complete", streamId: "s" };
      })();
    };
    const events = await collect(withRetry("s", factory, fastPolicy));
    expect(events.map((e) => e.type)).toEqual(["retrying", "token", "complete"]);
    expect(calls).toBe(2);
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    const factory = (): AsyncIterable<StreamEvent> => {
      calls++;
      return (async function* () {
        yield { type: "error", streamId: "s", transient: false, message: "auth" };
      })();
    };
    const events = await collect(withRetry("s", factory, fastPolicy));
    expect(events.map((e) => e.type)).toEqual(["error"]);
    expect(calls).toBe(1);
  });

  it("gives up after maxAttempts transient failures", async () => {
    let calls = 0;
    const factory = (): AsyncIterable<StreamEvent> => {
      calls++;
      return (async function* () {
        yield { type: "error", streamId: "s", transient: true, message: "flaky" };
      })();
    };
    const events = await collect(withRetry("s", factory, fastPolicy));
    // 2 retries shown, 3rd attempt's transient error yielded as final.
    expect(calls).toBe(fastPolicy.maxAttempts);
    expect(events.filter((e) => e.type === "retrying").length).toBe(fastPolicy.maxAttempts - 1);
    expect(events[events.length - 1]?.type).toBe("error");
  });
});
