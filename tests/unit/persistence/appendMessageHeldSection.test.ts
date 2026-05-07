// #276 — appendMessage is THREE sequential statements (SELECT MAX(idx),
// INSERT, UPDATE conversations.last_message_at). Outside a transaction
// each goes through the global op queue independently, so a concurrent
// transaction() can BEGIN between the SELECT_MAX and the INSERT and
// mutate the messages table — leaving appendMessage with a stale idx
// that may collide on the (conversation_id, idx) unique index.
//
// The fix is to hold the section across all three statements so nothing
// else can interleave. These tests pin that contract.

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql, __setImpl } from "@/lib/tauri/sql";
import type { SqlImpl } from "@/lib/tauri/sql";
import { transaction } from "@/lib/persistence/transaction";
import * as conversationsRepo from "@/lib/persistence/conversations";
import * as messagesRepo from "@/lib/persistence/messages";
import { appendMessage } from "@/lib/persistence/messages";
import type { Conversation, Message } from "@/lib/types";

let handle: TestDbHandle | null = null;

afterEach(() => {
  handle?.restore();
  handle = null;
});

const baseConv: Conversation = {
  id: "c1",
  title: "T",
  systemPrompt: null,
  createdAt: 0,
  lastProvider: null,
  displayMode: "lines",
  visibilityMode: "joined",
  visibilityMatrix: {},
  selectedPersonas: [],
  compactionFloorIndex: null,
  autocompactThreshold: null,
  contextWarningsFired: [],
};

function newPartial(content: string): Omit<Message, "id" | "index" | "createdAt"> {
  return {
    conversationId: "c1",
    role: "user",
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
  };
}

describe("appendMessage held-section atomicity (#276)", () => {
  // The contract: between an appendMessage's SELECT MAX(idx) and its
  // INSERT, no other top-level op (especially a transaction) can run.
  // Otherwise the transaction's writes can mutate the messages table
  // and the INSERT collides on the unique idx.

  it("a transaction queued mid-appendMessage cannot interleave its BEGIN", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    await messagesRepo.appendMessage(newPartial("seed-0"));

    // Hook the impl so the SELECT MAX(idx) on the appendMessage we're
    // about to fire triggers a concurrent transaction(). Without the
    // held-section fix, the transaction's BEGIN slips into the queue
    // ahead of appendMessage's INSERT.
    const realImpl = handle.impl;
    let triggeredTxn = false;
    let txnPromise: Promise<unknown> | null = null;
    const recorded: string[] = [];
    const wrapped: SqlImpl = {
      execute: async (q, p) => {
        recorded.push(`exec:${q}`);
        return realImpl.execute(q, p);
      },
      select: async <T = Record<string, unknown>>(q: string, p?: unknown[]): Promise<T[]> => {
        const isAppendMessageMaxRead = /\bmax\b/i.test(q) && /messages/i.test(q);
        recorded.push(`select:${q}`);
        if (isAppendMessageMaxRead && !triggeredTxn) {
          // The MAX(idx) read just landed in the queue. Fire a
          // transaction that does a write. This is the worst-case race
          // window the held section is supposed to seal.
          triggeredTxn = true;
          txnPromise = transaction(async (txn) => {
            // A no-op write so we exercise the BEGIN/COMMIT path. The
            // recorded log will capture the BEGIN-COMMIT boundary so
            // the test can assert it doesn't bracket the appendMessage.
            await txn.sql.execute(
              "UPDATE conversations SET title = ? WHERE id = ?",
              ["touched", "c1"],
            );
          });
        }
        return realImpl.select<T>(q, p);
      },
      close: () => realImpl.close(),
    };
    __setImpl(wrapped);

    await appendMessage(newPartial("hello"));
    if (txnPromise) await txnPromise;

    // The contract: the appendMessage's MAX-read, INSERT and the
    // last_message_at UPDATE form a contiguous group with no
    // BEGIN/COMMIT bracketing them.
    const startIdx = recorded.findIndex(
      (r) => r.startsWith("select:") && /\bmax\b/i.test(r) && /messages/i.test(r),
    );
    const insertIdx = recorded.findIndex(
      (r, i) =>
        i > startIdx && r.startsWith("exec:") && /^exec:\s*insert\b/i.test(r) && /messages/i.test(r),
    );
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(startIdx);
    const between = recorded.slice(startIdx + 1, insertIdx);
    // Pre-fix: between contains an exec:BEGIN (the transaction sneaked
    // in). Post-fix: between is free of BEGIN/COMMIT/UPDATE-from-txn.
    for (const r of between) {
      expect(/^exec:\s*begin\b/i.test(r)).toBe(false);
      expect(/^exec:\s*commit\b/i.test(r)).toBe(false);
    }
  });

  it("two concurrent appendMessage + one transaction produce a strictly-monotonic idx sequence", async () => {
    // The high-level invariant Codex recommended: under interleaved
    // concurrent load, no UNIQUE constraint failures, and the resulting
    // idx values are strictly monotonic.
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    await messagesRepo.appendMessage(newPartial("seed-0"));

    // Three concurrent operations, each producing one new message.
    const a = appendMessage(newPartial("A"));
    const t = transaction(async (txn) => {
      // Use the repo's appendMessage with the txn db so the in-txn
      // write is on the queue-bypassing path (the section already
      // owns the writer lock).
      await messagesRepo.appendMessage(newPartial("T-inner"), txn.db);
    });
    const b = appendMessage(newPartial("B"));

    await Promise.all([a, t, b]);

    // 1 seed + 2 appends + 1 in-txn = 4 messages.
    const after = await messagesRepo.listMessages("c1");
    expect(after).toHaveLength(4);

    // Strictly monotonic; no duplicate idx.
    const idxs = after.map((m) => m.index).sort((x, y) => x - y);
    expect(idxs).toEqual([0, 1, 2, 3]);
    // Pin no duplicate idx (would surface as UNIQUE failure in the impl
    // even before the array check, but be explicit).
    const unique = new Set(idxs);
    expect(unique.size).toBe(idxs.length);
  });

  it("sequential appendMessage calls remain in order (no regression)", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);

    for (const c of ["a", "b", "c", "d"]) {
      await appendMessage(newPartial(c));
    }
    const after = await messagesRepo.listMessages("c1");
    expect(after.map((m) => m.content)).toEqual(["a", "b", "c", "d"]);
    expect(after.map((m) => m.index)).toEqual([0, 1, 2, 3]);
  });
});

// Suppress lint on unused import — we re-export from messages above
// but the repo namespace is also threaded into the cross-call test.
void sql;
