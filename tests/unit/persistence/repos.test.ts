import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { __setImpl, __resetImpl } from "@/lib/tauri/sql";
import * as convRepo from "@/lib/persistence/conversations";
import * as personasRepo from "@/lib/persistence/personas";
import * as msgRepo from "@/lib/persistence/messages";
import * as settingsRepo from "@/lib/persistence/settings";

// Lightweight statement recorder + query-matcher: we don't run real
// SQL, we verify each repo issues the expected shape of statement
// with correctly-mapped parameters.
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

describe("conversationsRepo", () => {
  it("createConversation inserts with generated id and timestamp", async () => {
    const calls = makeRecorder();
    const c = await convRepo.createConversation({
      title: "T",
      systemPrompt: null,
      lastProvider: null,
      limitMarkIndex: null,
      displayMode: "lines",
      visibilityMode: "separated",
      visibilityMatrix: {},
    });
    expect(c.id).toMatch(/^c_/);
    expect(c.createdAt).toBeGreaterThan(0);
    const insert = calls.find((x) => x.sql.includes("INSERT INTO conversations"));
    expect(insert?.params[0]).toBe(c.id);
    expect(insert?.params[1]).toBe("T");
  });

  it("getConversation round-trips rows", async () => {
    makeRecorder({
      "FROM conversations WHERE id": [
        {
          id: "c_1",
          title: "x",
          system_prompt: null,
          created_at: 10,
          last_provider: "claude",
          limit_mark_index: null,
          display_mode: "cols",
          visibility_mode: "joined",
        },
      ],
    });
    const c = await convRepo.getConversation("c_1");
    expect(c?.displayMode).toBe("cols");
    expect(c?.visibilityMode).toBe("joined");
    expect(c?.lastProvider).toBe("claude");
  });
});

describe("personasRepo", () => {
  it("listPersonas default hides tombstones", async () => {
    const calls = makeRecorder();
    await personasRepo.listPersonas("c_1");
    expect(calls[0]?.sql).toContain("deleted_at IS NULL");
  });
  it("listPersonas includeDeleted=true skips filter", async () => {
    const calls = makeRecorder();
    await personasRepo.listPersonas("c_1", true);
    expect(calls[0]?.sql.includes("deleted_at IS NULL")).toBe(false);
  });
  it("tombstonePersona stamps a deletedAt", async () => {
    const calls = makeRecorder();
    await personasRepo.tombstonePersona("p_1", 999);
    expect(calls[0]?.params).toEqual([999, "p_1"]);
  });
});

describe("messagesRepo", () => {
  it("appendMessage allocates monotonic index", async () => {
    const calls = makeRecorder({ "MAX(idx)": [{ next: 7 }] });
    const m = await msgRepo.appendMessage({
      conversationId: "c_1",
      role: "user",
      content: "hi",
      provider: null,
      model: null,
      personaId: null,
      displayMode: "lines",
      pinned: false,
      pinTarget: null,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: 0,
      usageEstimated: false,
      audience: [],
    });
    expect(m.index).toBe(7);
    const insert = calls.find((c) => c.sql.includes("INSERT INTO messages"));
    expect(insert?.params).toBeDefined();
    // addressed_to is column index 10 (0-based id=0).
    expect(insert?.params[10]).toBe("[]");
  });

  it("rowToMessage parses addressed_to JSON defensively", async () => {
    makeRecorder({
      "FROM messages WHERE id": [
        {
          id: "m_1",
          conversation_id: "c_1",
          role: "assistant",
          content: "x",
          provider: "mock",
          model: "m1",
          persona_id: null,
          display_mode: "lines",
          pinned: 1,
          pin_target: null,
          addressed_to: "not-json",
          created_at: 0,
          idx: 0,
          error_message: null,
          error_transient: 0,
        },
      ],
    });
    const m = await msgRepo.getMessage("m_1");
    expect(m?.addressedTo).toEqual([]);
    expect(m?.pinned).toBe(true);
  });
});

describe("settingsRepo", () => {
  it("setSetting uses upsert", async () => {
    const calls = makeRecorder();
    await settingsRepo.setSetting("theme", "dark");
    expect(calls[0]?.sql).toContain("ON CONFLICT(key) DO UPDATE");
    expect(calls[0]?.params).toEqual(["theme", "dark"]);
  });
});
