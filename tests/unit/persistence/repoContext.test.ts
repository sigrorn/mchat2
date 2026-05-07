// #272 — RepoContext bundles repos pre-bound to a specific Kysely
// instance. Inside a transaction body, callers reach for `repos =
// reposFor(txn.db)` and use `repos.messages.foo(args)` instead of
// `messagesRepo.foo(args, txn.db)`. Discipline becomes structural —
// you can't accidentally reach the global db from inside the section
// because you're holding repos, not db.
//
// Contract pinned here: a repo bound to one Kysely impl never writes
// through another. Verified with a transaction-rollback witness — if
// the bound repo wrote through the global db, the rollback would NOT
// erase the write.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { reposFor } from "@/lib/persistence/repoContext";
import { transaction } from "@/lib/persistence/transaction";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";

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

describe("RepoContext (#272)", () => {
  it("provides messages, personas, conversations, flows handles", async () => {
    handle = await createTestDb();
    const { db } = await import("@/lib/persistence/db");
    const repos = reposFor(db);
    expect(typeof repos.messages.appendMessage).toBe("function");
    expect(typeof repos.personas.createPersona).toBe("function");
    expect(typeof repos.conversations.updateConversation).toBe("function");
    expect(typeof repos.flows.upsertFlow).toBe("function");
  });

  it("a repo bound to txn.db rolls back with the transaction", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    await messagesRepo.appendMessage({
      conversationId: "c1",
      role: "user",
      content: "before",
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

    await expect(
      transaction(async (txn) => {
        const repos = reposFor(txn.db);
        await repos.messages.appendMessage({
          conversationId: "c1",
          role: "user",
          content: "added-then-rolled-back",
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
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const messages = await messagesRepo.listMessages("c1");
    // Critical: the rolled-back message must NOT be present. If
    // repos.messages.appendMessage had reached through the global db
    // instead of txn.db, the rollback wouldn't have erased it.
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("before");
  });

  it("repos bound to the global db write through it (default flavour)", async () => {
    handle = await createTestDb();
    await conversationsRepo.createConversation(baseConv);
    const { db } = await import("@/lib/persistence/db");
    const repos = reposFor(db);
    await repos.messages.appendMessage({
      conversationId: "c1",
      role: "user",
      content: "via-default-repos",
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
    const messages = await messagesRepo.listMessages("c1");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("via-default-repos");
  });
});
