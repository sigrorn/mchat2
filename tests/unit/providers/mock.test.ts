import { describe, it, expect } from "vitest";
import { mockAdapter } from "@/lib/providers";
import type { StreamEvent } from "@/lib/types";

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("mockAdapter", () => {
  it("emits default tokens + usage + complete", async () => {
    const events = await collect(
      mockAdapter.stream({
        streamId: "s1",
        model: "mock-1",
        messages: [{ role: "user", content: "hi" }],
        systemPrompt: null,
        apiKey: null,
      }),
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("token");
    expect(types).toContain("usage");
    expect(types[types.length - 1]).toBe("complete");
  });

  it("honors tokens directive", async () => {
    const events = await collect(
      mockAdapter.stream({
        streamId: "s1",
        model: "mock-1",
        messages: [{ role: "user", content: "say [[MOCK: tokens=foo|bar|baz]]" }],
        systemPrompt: null,
        apiKey: null,
      }),
    );
    const tokens = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
    expect(tokens).toEqual(["foo", "bar", "baz"]);
  });

  it("emits transient error without tokens", async () => {
    const events = await collect(
      mockAdapter.stream({
        streamId: "s1",
        model: "mock-1",
        messages: [{ role: "user", content: "[[MOCK: error=transient]]" }],
        systemPrompt: null,
        apiKey: null,
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", transient: true });
  });

  it("cancels when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const events = await collect(
      mockAdapter.stream({
        streamId: "s1",
        model: "mock-1",
        messages: [{ role: "user", content: "[[MOCK: tokens=a|b|c, delay=10]]" }],
        systemPrompt: null,
        apiKey: null,
        signal: ac.signal,
      }),
    );
    const last = events[events.length - 1];
    expect(last?.type).toBe("cancelled");
  });
});
