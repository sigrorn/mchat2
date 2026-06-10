// ------------------------------------------------------------------
// Component: //visibility default single-write test (#313)
// Responsibility: handleVisibilityDefault must persist the visibility
//                 matrix exactly once — via rebuildVisibilityFromPersona-
//                 Defaults (which writes persona_visibility + dual-writes
//                 the legacy JSON column). It must NOT then also call the
//                 broad setVisibilityMatrix store action, which would
//                 re-run updateConversation and DELETE+INSERT the three
//                 conversation junction tables to refresh one field. The
//                 UI cache refresh must go through the cache-only setter.
// Collaborators: lib/commands/handlers/visibility, persistence repos.
// ------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { __setImpl } from "@/lib/tauri/sql";
import type { SqlImpl } from "@/lib/tauri/sql";
import {
  createConversation,
  getConversation,
  updateConversation,
} from "@/lib/persistence/conversations";
import { createPersona } from "@/lib/persistence/personas";
import { listMessages } from "@/lib/persistence/messages";
import { appendMessage } from "@/lib/persistence/messages";
import { handleVisibilityDefault } from "@/lib/commands/handlers/visibility";
import type { CommandContext } from "@/lib/commands/handlers/types";
import type { Conversation } from "@/lib/types";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

function instrument(target: SqlImpl): { impl: SqlImpl; deleteOn: (t: string) => number; updateOn: (t: string) => number } {
  const deletes = new Map<string, number>();
  const updates = new Map<string, number>();
  const impl: SqlImpl = {
    async execute(q, p) {
      const d = q.match(/^\s*DELETE\s+FROM\s+["`]?(\w+)["`]?/i);
      if (d) deletes.set(d[1]!.toLowerCase(), (deletes.get(d[1]!.toLowerCase()) ?? 0) + 1);
      const u = q.match(/^\s*UPDATE\s+["`]?(\w+)["`]?/i);
      if (u) updates.set(u[1]!.toLowerCase(), (updates.get(u[1]!.toLowerCase()) ?? 0) + 1);
      return target.execute(q, p);
    },
    select: target.select.bind(target),
    close: target.close.bind(target),
  };
  return {
    impl,
    deleteOn: (t) => deletes.get(t.toLowerCase()) ?? 0,
    updateOn: (t) => updates.get(t.toLowerCase()) ?? 0,
  };
}

async function seedConv(): Promise<Conversation> {
  return createConversation({
    id: "c_vis",
    title: "t",
    systemPrompt: null,
    lastProvider: null,
    displayMode: "lines",
    visibilityMode: "separated",
    visibilityMatrix: {},
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
}

function makeCtx(conv: Conversation): CommandContext {
  return {
    rawInput: "//visibility default",
    conversation: conv,
    retry: async () => ({ ok: true }),
    send: async () => ({ ok: true }),
    deps: {
      getPersonas: () => [],
      appendNotice: async (conversationId: string, content: string) =>
        appendMessage({
          conversationId,
          role: "notice",
          content,
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
        }),
      // Cache-only refresh: must NOT touch the DB.
      applyVisibilityMatrixCache: () => {},
      // The broad path — mirrors the store action. If the handler still
      // calls this, updateConversation re-DELETE+INSERTs the junction
      // tables, which the count below catches.
      setVisibilityMatrix: async (id: string, matrix: Record<string, string[]>) => {
        const c = await getConversation(id);
        if (c) await updateConversation({ ...c, visibilityMatrix: matrix });
      },
    } as unknown as CommandContext["deps"],
  } as CommandContext;
}

describe("//visibility default writes the matrix once (#313)", () => {
  it("does not re-churn the conversation junction tables after the rebuild", async () => {
    handle = await createTestDb();
    const conv = await seedConv();
    await createPersona({
      id: "p_a",
      conversationId: conv.id,
      provider: "mock",
      name: "Alice",
      nameSlug: "alice",
      systemPromptOverride: null,
      modelOverride: null,
      colorOverride: null,
      createdAtMessageIndex: 0,
      sortOrder: 0,
      deletedAt: null,
      visibilityDefaults: { bob: "n" },
      openaiCompatPreset: null,
      roleLens: {},
    });
    await createPersona({
      id: "p_b",
      conversationId: conv.id,
      provider: "mock",
      name: "Bob",
      nameSlug: "bob",
      systemPromptOverride: null,
      modelOverride: null,
      colorOverride: null,
      createdAtMessageIndex: 0,
      sortOrder: 1,
      deletedAt: null,
      visibilityDefaults: {},
      openaiCompatPreset: null,
      roleLens: {},
    });

    const { impl, deleteOn } = instrument(handle.impl);
    __setImpl(impl);

    await handleVisibilityDefault(makeCtx(conv));

    // The rebuild owns persona_visibility; it never touches the other two
    // junction tables. The broad updateConversation path (if wrongly
    // invoked) DELETE+INSERTs all three. Pin that it is NOT invoked.
    expect(deleteOn("conversation_personas_selected")).toBe(0);
    expect(deleteOn("conversation_context_warnings")).toBe(0);

    // Behaviour intact: matrix reset persisted + a notice appended.
    const reloaded = await getConversation(conv.id);
    expect(reloaded?.visibilityMatrix["p_a"]).toEqual([]);
    const msgs = await listMessages(conv.id);
    expect(msgs.some((m) => m.role === "notice" && /persona defaults/.test(m.content))).toBe(true);
  });
});
