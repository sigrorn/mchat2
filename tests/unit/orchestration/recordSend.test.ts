// recordSend — write a send's side-effects to the new
// Run/RunTarget/Attempt model (#174 → #179). One Run per send, one
// RunTarget per addressed persona, one Attempt per RunTarget on
// initial send. Covers single-target, parallel multi-target, and DAG
// sends (the difference is only in target ordering — the data shape
// is the same).
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import { recordSend } from "@/lib/orchestration/recordSend";
import { listAttempts, listRunsForConversation } from "@/lib/persistence/runs";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversation(id = "c_1"): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES (?, 'T', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
    [id],
  );
}
async function seedPersona(id: string, slug: string): Promise<void> {
  await sql.execute(
    `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, visibility_defaults)
     VALUES (?, 'c_1', 'openai', ?, ?, 0, 0, '{}')`,
    [id, slug, slug],
  );
}

describe("recordSend", () => {
  it("opens a single kind=send Run with one RunTarget per assistant message", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_alice", "alice");
    await seedPersona("p_bob", "bob");
    await recordSend({
      conversationId: "c_1",
      now: 5000,
      newAssistantMessages: [
        {
          id: "m_1",
          personaId: "p_alice",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "alice reply",
          createdAt: 5100,
          inputTokens: 5,
          outputTokens: 7,
          ttftMs: 80,
          streamMs: 220,
          errorMessage: null,
          errorTransient: false,
        },
        {
          id: "m_2",
          personaId: "p_bob",
          targetKey: "bob",
          provider: "openai",
          model: "gpt-4",
          content: "bob reply",
          createdAt: 5200,
          inputTokens: 0,
          outputTokens: 0,
          ttftMs: null,
          streamMs: null,
          errorMessage: "rate limited",
          errorTransient: true,
        },
      ],
    });

    const runs = await listRunsForConversation("c_1");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).toBe("send");
    expect(runs[0]?.startedAt).toBe(5000);
    expect(runs[0]?.targets).toHaveLength(2);
    const aliceTarget = runs[0]?.targets.find((t) => t.targetKey === "alice");
    const bobTarget = runs[0]?.targets.find((t) => t.targetKey === "bob");
    expect(aliceTarget?.status).toBe("complete");
    expect(bobTarget?.status).toBe("error");

    const aliceAtt = await listAttempts(aliceTarget!.id);
    expect(aliceAtt).toHaveLength(1);
    expect(aliceAtt[0]?.sequence).toBe(1);
    expect(aliceAtt[0]?.content).toBe("alice reply");
    expect(aliceAtt[0]?.inputTokens).toBe(5);
    expect(aliceAtt[0]?.outputTokens).toBe(7);
    expect(aliceAtt[0]?.ttftMs).toBe(80);
    expect(aliceAtt[0]?.streamMs).toBe(220);

    const bobAtt = await listAttempts(bobTarget!.id);
    expect(bobAtt[0]?.errorMessage).toBe("rate limited");
    expect(bobAtt[0]?.errorTransient).toBe(true);
  });

  it("works for a single-target send (one RunTarget)", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_alice", "alice");
    await recordSend({
      conversationId: "c_1",
      now: 5000,
      newAssistantMessages: [
        {
          id: "m_1",
          personaId: "p_alice",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "alice solo",
          createdAt: 5100,
          inputTokens: 0,
          outputTokens: 0,
          ttftMs: null,
          streamMs: null,
          errorMessage: null,
          errorTransient: false,
        },
      ],
    });
    const runs = await listRunsForConversation("c_1");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.targets).toHaveLength(1);
  });

  it("is a no-op when no new assistant messages were produced", async () => {
    handle = await createTestDb();
    await seedConversation();
    await recordSend({
      conversationId: "c_1",
      now: 5000,
      newAssistantMessages: [],
    });
    const runs = await listRunsForConversation("c_1");
    expect(runs).toHaveLength(0);
  });
});
