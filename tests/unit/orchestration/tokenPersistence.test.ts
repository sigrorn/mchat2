// streamRunner persists token counts on completion — issue #2.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { runStream } from "@/lib/orchestration/streamRunner";
import { mockAdapter } from "@/lib/providers/mock";
import type { Conversation, Message, PersonaTarget } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
};

function target(): PersonaTarget {
  return { provider: "mock", personaId: null, key: "mock", displayName: "Mock" };
}

let calls: { sql: string; params: unknown[] }[];
beforeEach(() => {
  calls = [];
  __setImpl({
    async execute(q, p) {
      calls.push({ sql: q, params: p ?? [] });
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (q.includes("MAX(idx)")) return [{ next: 0 } as unknown as T];
      return [];
    },
    async close() {},
  });
});
afterEach(() => __resetImpl());

describe("streamRunner token persistence", () => {
  it("writes input/output token counts and the estimated flag on finalize", async () => {
    const history: Message[] = [
      {
        id: "m0",
        conversationId: "c_1",
        role: "user",
        content: "[[MOCK: tokens=ab|cd]]",
        provider: null,
        model: null,
        personaId: null,
        displayMode: "lines",
        pinned: false,
        pinTarget: null,
        addressedTo: [],
        createdAt: 0,
        index: 0,
        errorMessage: null,
        errorTransient: false,
        inputTokens: 0,
        outputTokens: 0,
        usageEstimated: false,
        audience: [],
      },
    ];
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target(),
      personas: [],
      history,
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
    });
    const tokenUpdate = calls.find(
      (c) => c.sql.includes("UPDATE messages SET") && c.sql.includes("input_tokens"),
    );
    expect(tokenUpdate).toBeDefined();
    const params = tokenUpdate?.params ?? [];
    // Params layout: (input_tokens, output_tokens, usage_estimated, id)
    expect(Number(params[0])).toBeGreaterThan(0);
    expect(Number(params[1])).toBeGreaterThan(0);
    expect(Number(params[2])).toBe(1);
  });
});
