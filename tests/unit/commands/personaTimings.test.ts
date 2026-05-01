// Tests for the per-persona timing aggregator (#122).
import { describe, it, expect } from "vitest";
import { aggregatePersonaTimings } from "@/lib/commands/personaTimings";
import type { Message, Persona } from "@/lib/types";

function persona(id: string): Persona {
  return {
    id,
    conversationId: "c1",
    provider: "openai",
    name: id.toUpperCase(),
    nameSlug: id,
    systemPromptOverride: null,
    modelOverride: null,
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    apertusProductId: null,
    visibilityDefaults: {}, openaiCompatPreset: null, roleLens: {},
  };
}

function assistantMsg(
  index: number,
  personaId: string | null,
  timings: { ttftMs?: number | null; streamMs?: number | null; outputTokens?: number } = {},
  errorMessage: string | null = null,
): Message {
  return {
    id: `m${index}`,
    conversationId: "c1",
    role: "assistant",
    content: "reply",
    provider: "openai",
    model: "gpt-4o",
    personaId,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: index * 1000,
    index,
    errorMessage,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: timings.outputTokens ?? 0,
    usageEstimated: false,
    audience: [],
    ttftMs: timings.ttftMs ?? null,
    streamMs: timings.streamMs ?? null,
  };
}

describe("aggregatePersonaTimings", () => {
  it("returns null fields when no assistant rows for the persona", () => {
    const out = aggregatePersonaTimings(persona("p1"), [], 0);
    expect(out).toEqual({ avgTtftMs: null, avgTokensPerSec: null });
  });

  it("ignores rows with missing ttft_ms or stream_ms (pre-migration)", () => {
    const messages = [
      assistantMsg(1, "p1", { ttftMs: null, streamMs: null, outputTokens: 100 }),
    ];
    expect(aggregatePersonaTimings(persona("p1"), messages, 0)).toEqual({
      avgTtftMs: null,
      avgTokensPerSec: null,
    });
  });

  it("ignores rows below the compaction floor", () => {
    const messages = [
      assistantMsg(1, "p1", { ttftMs: 500, streamMs: 2000, outputTokens: 100 }),
      assistantMsg(5, "p1", { ttftMs: 1000, streamMs: 4000, outputTokens: 200 }),
    ];
    // Floor at 3: first row excluded. Only the second (ttft 1000, throughput 200/4 = 50/s).
    const out = aggregatePersonaTimings(persona("p1"), messages, 3);
    expect(out.avgTtftMs).toBe(1000);
    expect(out.avgTokensPerSec).toBe(50);
  });

  it("averages ttft across multiple rows", () => {
    const messages = [
      assistantMsg(1, "p1", { ttftMs: 400, streamMs: 2000, outputTokens: 100 }),
      assistantMsg(2, "p1", { ttftMs: 600, streamMs: 2000, outputTokens: 100 }),
    ];
    const out = aggregatePersonaTimings(persona("p1"), messages, 0);
    expect(out.avgTtftMs).toBe(500);
  });

  it("excludes rows where stream_ms is 0 or output_tokens <= 1 from throughput", () => {
    const messages = [
      assistantMsg(1, "p1", { ttftMs: 400, streamMs: 2000, outputTokens: 100 }), // ok
      assistantMsg(2, "p1", { ttftMs: 400, streamMs: 0, outputTokens: 50 }), // skip throughput
      assistantMsg(3, "p1", { ttftMs: 400, streamMs: 1000, outputTokens: 1 }), // skip (1 token)
    ];
    const out = aggregatePersonaTimings(persona("p1"), messages, 0);
    expect(out.avgTtftMs).toBe(400);
    // Only row 1 contributes: 100 / (2000/1000) = 50 tok/s.
    expect(out.avgTokensPerSec).toBe(50);
  });

  it("ignores failed assistant rows", () => {
    const messages = [
      assistantMsg(1, "p1", { ttftMs: 400, streamMs: 2000, outputTokens: 100 }),
      assistantMsg(2, "p1", { ttftMs: 2000, streamMs: 500, outputTokens: 50 }, "boom"),
    ];
    const out = aggregatePersonaTimings(persona("p1"), messages, 0);
    // Only row 1 counts.
    expect(out.avgTtftMs).toBe(400);
    expect(out.avgTokensPerSec).toBe(50);
  });

  it("ignores rows from other personas", () => {
    const messages = [
      assistantMsg(1, "p1", { ttftMs: 100, streamMs: 1000, outputTokens: 100 }),
      assistantMsg(2, "p2", { ttftMs: 999, streamMs: 9000, outputTokens: 200 }),
    ];
    const out = aggregatePersonaTimings(persona("p1"), messages, 0);
    expect(out.avgTtftMs).toBe(100);
    expect(out.avgTokensPerSec).toBe(100);
  });
});
