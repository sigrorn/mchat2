// #65 — Persist persona selection across restarts.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import * as convRepo from "@/lib/persistence/conversations";

interface Call {
  sql: string;
  params: unknown[];
}

function makeRecorder(selectResults: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  __setImpl({
    async execute(q, p) {
      calls.push({ sql: q, params: p ?? [] });
      return { rowsAffected: 1, lastInsertId: null };
    },
    async select<T>(q: string, p?: unknown[]): Promise<T[]> {
      calls.push({ sql: q, params: p ?? [] });
      for (const [needle, rows] of Object.entries(selectResults)) {
        if (q.includes(needle)) return rows as T[];
      }
      return [];
    },
    async close() {},
  });
  return calls;
}

beforeEach(() =>
  __setImpl({
    execute: async () => ({ rowsAffected: 0, lastInsertId: null }),
    select: async () => [],
    close: async () => {},
  }),
);
afterEach(() => __resetImpl());

describe("selectedPersonas persistence (#65)", () => {
  it("createConversation stores selectedPersonas as JSON", async () => {
    const calls = makeRecorder();
    const c = await convRepo.createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: ["p_abc", "p_def"],
    });
    expect(c.selectedPersonas).toEqual(["p_abc", "p_def"]);
    const insert = calls.find((x) => x.sql.includes("INSERT INTO conversations"));
    expect(insert).toBeDefined();
    // The JSON-encoded array should be in the params.
    expect(insert!.params).toContain('["p_abc","p_def"]');
  });

  it("getConversation round-trips selectedPersonas from DB row", async () => {
    makeRecorder({
      "FROM conversations WHERE id": [
        {
          id: "c_1",
          title: "x",
          system_prompt: null,
          created_at: 10,
          last_provider: null,
          limit_mark_index: null,
          display_mode: "lines",
          visibility_mode: "separated",
          visibility_matrix: "{}",
          limit_size_tokens: null,
          selected_personas: '["p_abc","p_def"]',
        },
      ],
    });
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual(["p_abc", "p_def"]);
  });

  it("getConversation defaults to empty array when column is missing", async () => {
    makeRecorder({
      "FROM conversations WHERE id": [
        {
          id: "c_1",
          title: "x",
          system_prompt: null,
          created_at: 10,
          last_provider: null,
          limit_mark_index: null,
          display_mode: "lines",
          visibility_mode: "separated",
        },
      ],
    });
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual([]);
  });

  it("getConversation handles malformed JSON gracefully", async () => {
    makeRecorder({
      "FROM conversations WHERE id": [
        {
          id: "c_1",
          title: "x",
          system_prompt: null,
          created_at: 10,
          last_provider: null,
          limit_mark_index: null,
          display_mode: "lines",
          visibility_mode: "separated",
          selected_personas: "not-json",
        },
      ],
    });
    const c = await convRepo.getConversation("c_1");
    expect(c?.selectedPersonas).toEqual([]);
  });

  it("updateConversation writes selectedPersonas as JSON", async () => {
    const calls = makeRecorder();
    await convRepo.updateConversation({
      id: "c_1",
      title: "T",
      systemPrompt: null,
      createdAt: 10,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
      limitSizeTokens: null,
      selectedPersonas: ["p_xyz"],
    });
    const update = calls.find((x) => x.sql.includes("UPDATE conversations"));
    expect(update).toBeDefined();
    expect(update!.params).toContain('["p_xyz"]');
  });
});
