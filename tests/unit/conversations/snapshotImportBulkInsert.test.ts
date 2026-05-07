// #278 — snapshotImport's per-message appendMessage loop holds the
// writer lock for seconds on a 1000-message import (1000 × IPC round-
// trip). Replace it with a bulk INSERT (one statement per batch,
// chunked to respect SQLite's parameter limit). The test pins the
// statement count, idx contiguity, and order preservation — wall-clock
// benchmarks are too flaky across CI environments.

import { describe, it, expect, afterEach, vi } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { __setImpl } from "@/lib/tauri/sql";
import type { SqlImpl } from "@/lib/tauri/sql";
import { importSnapshot } from "@/lib/conversations/snapshotImport";
import { parseSnapshot } from "@/lib/schemas/snapshot";
import * as messagesRepo from "@/lib/persistence/messages";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
  vi.restoreAllMocks();
});

function buildSnapshot(opts: { messageCount: number }): string {
  const messages = Array.from({ length: opts.messageCount }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `m${i}`,
    persona: i % 2 === 0 ? null : "Alice",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    audience: [],
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    errorMessage: null,
    errorTransient: false,
    displayMode: "lines",
    provider: i % 2 === 0 ? null : "mock",
    model: i % 2 === 0 ? null : "mock-1",
    index: i,
    createdAt: 1000 + i,
  }));
  return JSON.stringify({
    version: 1 as const,
    title: "BulkImport",
    systemPrompt: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    compactionFloorIndex: null,
    selectedPersonas: [],
    personas: [
      {
        name: "Alice",
        provider: "mock",
        systemPromptOverride: null,
        modelOverride: null,
        colorOverride: null,
        visibilityDefaults: {},
        sortOrder: 0,
        createdAtMessageIndex: 0,
      },
    ],
    messages,
  });
}

/** Wrap the current SqlImpl so we can count INSERTs into a target table. */
function instrumentImpl(target: SqlImpl): {
  impl: SqlImpl;
  insertCounts: () => Map<string, number>;
} {
  const counts = new Map<string, number>();
  const impl: SqlImpl = {
    async execute(q, p) {
      const m = q.match(/INSERT\s+INTO\s+["`]?(\w+)["`]?/i);
      if (m) {
        const table = m[1]!.toLowerCase();
        counts.set(table, (counts.get(table) ?? 0) + 1);
      }
      return target.execute(q, p);
    },
    select: target.select.bind(target),
    close: target.close.bind(target),
  };
  return { impl, insertCounts: () => counts };
}

describe("importSnapshot bulk-insert (#278)", () => {
  it("issues at most ceil(N / batchSize) message INSERTs (not N)", async () => {
    handle = await createTestDb();
    const N = 250; // exercise multiple batches at BATCH_SIZE=100
    const parsed = parseSnapshot(buildSnapshot({ messageCount: N }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    // Wrap the in-memory impl with an INSERT-counter, then re-install.
    const { impl: counted, insertCounts } = instrumentImpl(handle.impl);
    __setImpl(counted);

    const result = await importSnapshot(parsed.snapshot);
    expect(result.conversation.title).toBe("BulkImport");

    const messageInserts = insertCounts().get("messages") ?? 0;
    // Pre-#278: one INSERT per message → 250 inserts.
    // Post-#278 with BATCH_SIZE=100: 3 inserts.
    // Assert "fewer than half N" so we don't over-fit on a specific
    // batch size and still catch the "still-per-row" regression.
    expect(messageInserts).toBeLessThan(N / 2);
    expect(messageInserts).toBeGreaterThanOrEqual(1);
  });

  it("imported messages have contiguous 0-based monotonic idx", async () => {
    handle = await createTestDb();
    const N = 50;
    const parsed = parseSnapshot(buildSnapshot({ messageCount: N }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await importSnapshot(parsed.snapshot);
    const messages = await messagesRepo.listMessages(result.conversation.id);
    expect(messages).toHaveLength(N);
    expect(messages.map((m) => m.index)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
  });

  it("preserves the snapshot's message order in content", async () => {
    handle = await createTestDb();
    const N = 30;
    const parsed = parseSnapshot(buildSnapshot({ messageCount: N }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await importSnapshot(parsed.snapshot);
    const messages = await messagesRepo.listMessages(result.conversation.id);
    expect(messages.map((m) => m.content)).toEqual(
      Array.from({ length: N }, (_, i) => `m${i}`),
    );
  });
});
