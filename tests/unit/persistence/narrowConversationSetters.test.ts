// #283 — broader narrow-setter sweep across conversationsStore.
// Pre-fix every UI toggle (rename, setDisplayMode, setFlowMode, etc.)
// went through the full updateConversation, which DELETE+INSERTs three
// junction tables and rewrites every column to flip ONE field. These
// tests pin the new narrow-write contracts.

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { __setImpl } from "@/lib/tauri/sql";
import type { SqlImpl } from "@/lib/tauri/sql";
import * as conversationsRepo from "@/lib/persistence/conversations";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

const baseConv = {
  id: "c1",
  title: "Original",
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

interface Counters {
  updateOnTable: (table: string) => number;
  deleteOnTable: (table: string) => number;
  insertOnTable: (table: string) => number;
}

function instrumentImpl(target: SqlImpl): { impl: SqlImpl; counters: Counters } {
  const updates = new Map<string, number>();
  const deletes = new Map<string, number>();
  const inserts = new Map<string, number>();
  const impl: SqlImpl = {
    async execute(q, p) {
      const u = q.match(/^\s*UPDATE\s+["`]?(\w+)["`]?/i);
      if (u) updates.set(u[1]!.toLowerCase(), (updates.get(u[1]!.toLowerCase()) ?? 0) + 1);
      const d = q.match(/^\s*DELETE\s+FROM\s+["`]?(\w+)["`]?/i);
      if (d) deletes.set(d[1]!.toLowerCase(), (deletes.get(d[1]!.toLowerCase()) ?? 0) + 1);
      const i = q.match(/^\s*INSERT\s+INTO\s+["`]?(\w+)["`]?/i);
      if (i) inserts.set(i[1]!.toLowerCase(), (inserts.get(i[1]!.toLowerCase()) ?? 0) + 1);
      return target.execute(q, p);
    },
    select: target.select.bind(target),
    close: target.close.bind(target),
  };
  return {
    impl,
    counters: {
      updateOnTable: (t) => updates.get(t.toLowerCase()) ?? 0,
      deleteOnTable: (t) => deletes.get(t.toLowerCase()) ?? 0,
      insertOnTable: (t) => inserts.get(t.toLowerCase()) ?? 0,
    },
  };
}

describe("narrow conversation setters (#283)", () => {
  it("setConversationTitle issues exactly one UPDATE conversations and no junction churn", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    const { impl: counted, counters } = instrumentImpl(handle.impl);
    __setImpl(counted);

    await conversationsRepo.setConversationTitle("c1", "Renamed");

    expect(counters.updateOnTable("conversations")).toBe(1);
    expect(counters.deleteOnTable("conversation_personas_selected")).toBe(0);
    expect(counters.deleteOnTable("conversation_context_warnings")).toBe(0);
    expect(counters.deleteOnTable("persona_visibility")).toBe(0);
    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.title).toBe("Renamed");
  });

  it("setConversationDisplayMode issues exactly one UPDATE and no junction churn", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    const { impl: counted, counters } = instrumentImpl(handle.impl);
    __setImpl(counted);

    await conversationsRepo.setConversationDisplayMode("c1", "cols");

    expect(counters.updateOnTable("conversations")).toBe(1);
    expect(counters.deleteOnTable("conversation_personas_selected")).toBe(0);
    expect(counters.deleteOnTable("conversation_context_warnings")).toBe(0);
    expect(counters.deleteOnTable("persona_visibility")).toBe(0);
    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.displayMode).toBe("cols");
  });

  it("setConversationFlowMode issues exactly one UPDATE and no junction churn", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    const { impl: counted, counters } = instrumentImpl(handle.impl);
    __setImpl(counted);

    await conversationsRepo.setConversationFlowMode("c1", true);

    expect(counters.updateOnTable("conversations")).toBe(1);
    expect(counters.deleteOnTable("conversation_personas_selected")).toBe(0);
    expect(counters.deleteOnTable("conversation_context_warnings")).toBe(0);
    expect(counters.deleteOnTable("persona_visibility")).toBe(0);
    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.flowMode).toBe(true);
  });

  it("setConversationAutocompact issues at most two writes (the threshold + an optional context-warnings clear)", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation({
      ...baseConv,
      contextWarningsFired: [80],
    });
    const { impl: counted, counters } = instrumentImpl(handle.impl);
    __setImpl(counted);

    await conversationsRepo.setConversationAutocompact("c1", {
      mode: "kTokens",
      value: 100,
    });

    expect(counters.updateOnTable("conversations")).toBe(1);
    // Clearing fired warnings: one DELETE on the warnings junction —
    // not the heavy 3-junction rewrite.
    const warningsDeletes = counters.deleteOnTable("conversation_context_warnings");
    expect(warningsDeletes).toBeLessThanOrEqual(1);
    // The other two junction tables stay untouched.
    expect(counters.deleteOnTable("conversation_personas_selected")).toBe(0);
    expect(counters.deleteOnTable("persona_visibility")).toBe(0);

    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.autocompactThreshold).toEqual({ mode: "kTokens", value: 100 });
    expect(reloaded?.contextWarningsFired).toEqual([]);
  });

  it("setConversationAutocompact off-mode keeps existing fired warnings", async () => {
    // Per conversationsStore.setAutocompact: contextWarningsFired clears
    // only when turning autocompact ON. Turning it OFF leaves them.
    handle = await createTestDb();
    await conversationsRepo.createConversation({
      ...baseConv,
      contextWarningsFired: [80, 90],
    });
    await conversationsRepo.setConversationAutocompact("c1", null);

    const reloaded = await conversationsRepo.getConversation("c1");
    expect(reloaded?.autocompactThreshold).toBeNull();
    expect(reloaded?.contextWarningsFired).toEqual([80, 90]);
  });
});
