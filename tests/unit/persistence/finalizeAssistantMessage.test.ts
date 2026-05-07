// #282 — replaces streamRunner's 4-6 sequential UPDATE calls per
// stream completion with one finalizeAssistantMessage call. Tests pin
// the statement-count contract (1 UPDATE messages + 1 UPDATE
// conversations regardless of which optional fields are passed) and
// the field-skipping contract (undefined keys don't appear in the SET
// list).

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { __setImpl } from "@/lib/tauri/sql";
import type { SqlImpl } from "@/lib/tauri/sql";
import * as conversationsRepo from "@/lib/persistence/conversations";
import * as personasRepo from "@/lib/persistence/personas";
import * as messagesRepo from "@/lib/persistence/messages";
import { finalizeAssistantMessage } from "@/lib/persistence/messages";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

const baseConv = {
  id: "c1",
  title: "T",
  systemPrompt: null,
  lastProvider: null,
  displayMode: "lines" as const,
  visibilityMode: "joined" as const,
  visibilityMatrix: {},
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

async function seedAssistantPlaceholder(): Promise<string> {
  await conversationsRepo.createConversation(baseConv);
  await personasRepo.createPersona({
    id: "p1",
    conversationId: "c1",
    provider: "mock",
    name: "Alice",
    nameSlug: "alice",
    systemPromptOverride: null,
    modelOverride: "mock-1",
    colorOverride: null,
    createdAtMessageIndex: 0,
    sortOrder: 0,
    deletedAt: null,
    visibilityDefaults: {},
    openaiCompatPreset: null,
    roleLens: {},
  });
  const msg = await messagesRepo.appendMessage({
    conversationId: "c1",
    role: "assistant",
    content: "",
    provider: "mock",
    model: "mock-1",
    personaId: "p1",
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
  return msg.id;
}

/** Wrap impl to count UPDATE statements per table. */
function instrumentImpl(target: SqlImpl): {
  impl: SqlImpl;
  updateCounts: () => Map<string, number>;
  setClauses: () => string[];
} {
  const counts = new Map<string, number>();
  const setClauses: string[] = [];
  const impl: SqlImpl = {
    async execute(q, p) {
      const m = q.match(/^\s*UPDATE\s+["`]?(\w+)["`]?\s+SET\s+(.+?)\s+WHERE/i);
      if (m) {
        const table = m[1]!.toLowerCase();
        counts.set(table, (counts.get(table) ?? 0) + 1);
        setClauses.push(`${table}: ${m[2]!}`);
      }
      return target.execute(q, p);
    },
    select: target.select.bind(target),
    close: target.close.bind(target),
  };
  return { impl, updateCounts: () => counts, setClauses: () => setClauses };
}

describe("finalizeAssistantMessage (#282)", () => {
  it("issues exactly one UPDATE messages + one UPDATE conversations on the success path", async () => {
    handle = await createTestDb();
    const id = await seedAssistantPlaceholder();

    const { impl: counted, updateCounts } = instrumentImpl(handle.impl);
    __setImpl(counted);

    await finalizeAssistantMessage(id, {
      content: "the answer",
      errorMessage: null,
      errorTransient: false,
      inputTokens: 100,
      outputTokens: 50,
      usageEstimated: false,
      costUsd: 0.0042,
      ttftMs: 30,
      streamMs: 200,
    });

    const counts = updateCounts();
    expect(counts.get("messages") ?? 0).toBe(1);
    expect(counts.get("conversations") ?? 0).toBe(1);
  });

  it("skips columns that weren't supplied (undefined keys don't appear in SET)", async () => {
    handle = await createTestDb();
    const id = await seedAssistantPlaceholder();

    const { impl: counted, setClauses } = instrumentImpl(handle.impl);
    __setImpl(counted);

    // Call with the minimum required surface (content + error).
    // The cost / timing / usage columns should NOT be touched.
    await finalizeAssistantMessage(id, {
      content: "partial",
      errorMessage: "stream interrupted",
      errorTransient: true,
    });

    const messagesUpdate = setClauses().find((s) => s.startsWith("messages:"));
    expect(messagesUpdate).toBeDefined();
    // Columns NOT supplied — must not appear in the SET list.
    expect(messagesUpdate).not.toMatch(/input_tokens|output_tokens|usage_estimated/);
    expect(messagesUpdate).not.toMatch(/cost_usd/);
    expect(messagesUpdate).not.toMatch(/ttft_ms|stream_ms/);
    // Columns SUPPLIED — must appear.
    expect(messagesUpdate).toMatch(/content/);
    expect(messagesUpdate).toMatch(/error_message/);
    expect(messagesUpdate).toMatch(/error_transient/);
  });

  it("persists every optional column when all are supplied", async () => {
    handle = await createTestDb();
    const id = await seedAssistantPlaceholder();

    await finalizeAssistantMessage(id, {
      content: "final",
      errorMessage: null,
      errorTransient: false,
      inputTokens: 200,
      outputTokens: 80,
      usageEstimated: true,
      costUsd: 0.0123,
      ttftMs: 12,
      streamMs: 340,
    });

    const messages = await messagesRepo.listMessages("c1");
    const m = messages.find((x) => x.id === id)!;
    expect(m.content).toBe("final");
    expect(m.errorMessage).toBeNull();
    expect(m.errorTransient).toBe(false);
    expect(m.inputTokens).toBe(200);
    expect(m.outputTokens).toBe(80);
    expect(m.usageEstimated).toBe(true);
    expect(m.costUsd).toBeCloseTo(0.0123);
    expect(m.ttftMs).toBe(12);
    expect(m.streamMs).toBe(340);
  });
});
