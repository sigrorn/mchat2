// streamRunner populates assistant.audience from the prior user row — issue #4.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import { runStream } from "@/lib/orchestration/streamRunner";
import { mockAdapter } from "@/lib/providers/mock";
import { makeMessage } from "@/lib/persistence/messages";
import type { Conversation, PersonaTarget } from "@/lib/types";

const CONV: Conversation = {
  id: "c_1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  limitMarkIndex: null,
  displayMode: "lines",
  visibilityMode: "separated",
  visibilityMatrix: {},
  limitSizeTokens: null,
  selectedPersonas: [],
    compactionFloorIndex: null,
};

function target(key: string): PersonaTarget {
  return { provider: "mock", personaId: key, key, displayName: key };
}

let inserts: { sql: string; params: unknown[] }[];
beforeEach(() => {
  inserts = [];
  __setImpl({
    async execute(q, p) {
      if (q.startsWith("INSERT INTO messages")) {
        inserts.push({ sql: q, params: p ?? [] });
      }
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string): Promise<T[]> {
      if (q.includes("MAX(idx)")) return [{ next: 1 } as unknown as T];
      return [];
    },
    async close() {},
  });
});
afterEach(() => __resetImpl());

describe("streamRunner audience propagation", () => {
  it("copies the prior user row's addressedTo into the assistant placeholder audience", async () => {
    const history = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "hi",
        addressedTo: ["p_a", "p_b"],
        index: 0,
      }),
    ];
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target("p_a"),
      personas: [],
      history,
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
    });
    expect(inserts).toHaveLength(1);
    // INSERT param layout: see messagesRepo — audience is the 19th
    // column (after usage_estimated). Find by JSON content to stay
    // resilient to column reordering.
    const params = inserts[0]?.params ?? [];
    const audienceParam = params.find(
      (p) => typeof p === "string" && p.startsWith("[") && p.includes("p_a") && p.includes("p_b"),
    );
    expect(audienceParam).toBe(JSON.stringify(["p_a", "p_b"]));
  });

  it("writes an empty audience when the prior user row was implicit", async () => {
    const history = [
      makeMessage({
        conversationId: "c_1",
        role: "user",
        content: "hi",
        addressedTo: [],
        index: 0,
      }),
    ];
    await runStream({
      streamId: "s1",
      conversation: CONV,
      target: target("p_a"),
      personas: [],
      history,
      adapter: mockAdapter,
      apiKey: null,
      model: "mock-1",
      displayMode: "lines",
    });
    const params = inserts[0]?.params ?? [];
    const jsonParams = params.filter(
      (p): p is string => typeof p === "string" && p.startsWith("["),
    );
    // audience param is the second JSON array (after addressed_to).
    expect(jsonParams).toContain("[]");
  });
});
