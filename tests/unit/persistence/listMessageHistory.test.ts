// #181 follow-up — message-level history lookup. Replaces the
// attempt-id-keyed listAttemptHistoryForMessage which broke for
// messages from the random-attempt-id window (#179 → #205). Reads
// messages.superseded_at directly so the affordance works for ALL
// data, not just pre-#179 backfill or post-#205 sends.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import { listMessageHistory } from "@/lib/persistence/messages";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConv(id = "c_1"): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES (?, 't', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
    [id],
  );
}

async function seedAssistant(args: {
  id: string;
  conversationId?: string;
  personaId?: string | null;
  provider?: string | null;
  idx: number;
  content: string;
  supersededAt?: number | null;
}): Promise<void> {
  await sql.execute(
    `INSERT INTO messages (id, conversation_id, role, content, provider, model, persona_id,
                           display_mode, pinned, addressed_to, created_at, idx,
                           error_transient, input_tokens, output_tokens,
                           usage_estimated, audience, superseded_at)
     VALUES (?, ?, 'assistant', ?, ?, NULL, ?, 'lines', 0, '[]', ?, ?, 0, 0, 0, 0, '[]', ?)`,
    [
      args.id,
      args.conversationId ?? "c_1",
      args.content,
      args.provider ?? "mock",
      args.personaId ?? null,
      args.idx,
      args.idx,
      args.supersededAt ?? null,
    ],
  );
}

describe("listMessageHistory (#181)", () => {
  it("returns superseded predecessors for the same persona, ordered by index", async () => {
    handle = await createTestDb();
    await seedConv();
    // Three replies for persona alice in chronological order; first
    // two were superseded by replays/retries; the third is current.
    await seedAssistant({ id: "m_a1", personaId: "p_alice", idx: 1, content: "first try", supersededAt: 100 });
    await seedAssistant({ id: "m_a2", personaId: "p_alice", idx: 3, content: "second try", supersededAt: 200 });
    await seedAssistant({ id: "m_a3", personaId: "p_alice", idx: 5, content: "current", supersededAt: null });
    // Bob's replies are not in alice's history.
    await seedAssistant({ id: "m_b1", personaId: "p_bob", idx: 2, content: "bob reply", supersededAt: 100 });

    const history = await listMessageHistory("c_1", "m_a3");
    expect(history.map((m) => m.id)).toEqual(["m_a1", "m_a2"]);
    expect(history[0]?.content).toBe("first try");
    expect(history[1]?.content).toBe("second try");
  });

  it("returns empty when the current message has no superseded siblings", async () => {
    handle = await createTestDb();
    await seedConv();
    await seedAssistant({ id: "m_a1", personaId: "p_alice", idx: 1, content: "only attempt", supersededAt: null });
    const history = await listMessageHistory("c_1", "m_a1");
    expect(history).toEqual([]);
  });

  it("returns empty when the messageId is unknown", async () => {
    handle = await createTestDb();
    await seedConv();
    const history = await listMessageHistory("c_1", "m_missing");
    expect(history).toEqual([]);
  });

  it("works for old data with random attempt ids (the #179-#205 window)", async () => {
    // The pre-#181 listAttemptHistoryForMessage chased att_<msgId>
    // and would return [] here because the attempts table has random
    // ids that don't map back. Reading messages.superseded_at
    // directly works regardless.
    handle = await createTestDb();
    await seedConv();
    await seedAssistant({ id: "m_old", personaId: "p_alice", idx: 1, content: "old reply", supersededAt: 100 });
    await seedAssistant({ id: "m_new", personaId: "p_alice", idx: 2, content: "current", supersededAt: null });
    // Insert a runs/run_targets/attempts chain with RANDOM attempt
    // ids — represents the #179-#205 production state.
    await sql.execute(
      `INSERT INTO runs (id, conversation_id, kind, started_at) VALUES ('run_x', 'c_1', 'send', 1)`,
    );
    await sql.execute(
      `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
       VALUES ('rt_x', 'run_x', 'alice', 'p_alice', 'mock', 'mock', 'complete')`,
    );
    await sql.execute(
      `INSERT INTO attempts (id, run_target_id, sequence, content, started_at, superseded_at,
                             error_transient, input_tokens, output_tokens)
       VALUES ('att_random_xyz', 'rt_x', 1, 'old reply', 1, 100, 0, 0, 0)`,
    );
    const history = await listMessageHistory("c_1", "m_new");
    expect(history.map((m) => m.id)).toEqual(["m_old"]);
  });

  it("scopes by conversation", async () => {
    handle = await createTestDb();
    await seedConv("c_1");
    await seedConv("c_2");
    await seedAssistant({ id: "m_other_old", conversationId: "c_2", personaId: "p_alice", idx: 1, content: "other", supersededAt: 100 });
    await seedAssistant({ id: "m_a1", conversationId: "c_1", personaId: "p_alice", idx: 2, content: "current", supersededAt: null });
    const history = await listMessageHistory("c_1", "m_a1");
    expect(history).toEqual([]);
  });

  it("falls back to provider when persona_id is null (bare-provider rows)", async () => {
    // For bare @provider sends without a persona, persona_id is null.
    // History must still group correctly — by provider in that case.
    handle = await createTestDb();
    await seedConv();
    await seedAssistant({ id: "m_bare1", personaId: null, provider: "openai", idx: 1, content: "old bare", supersededAt: 100 });
    await seedAssistant({ id: "m_bare2", personaId: null, provider: "openai", idx: 2, content: "current bare", supersededAt: null });
    // Different provider — should be excluded from openai bare-provider history.
    await seedAssistant({ id: "m_other_bare", personaId: null, provider: "claude", idx: 3, content: "different provider", supersededAt: 100 });
    const history = await listMessageHistory("c_1", "m_bare2");
    expect(history.map((m) => m.id)).toEqual(["m_bare1"]);
  });
});
