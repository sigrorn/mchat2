// recordReplay — write the side-effects of a replay into the new
// Run/RunTarget/Attempt model (#174 → #177). This is a parallel-write
// path: the messages table still owns the UI projection (until #180
// flips that); the attempts model is built up alongside so the model's
// shape can be validated before the UI moves.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import { recordReplay } from "@/lib/orchestration/recordReplay";
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
async function seedAssistantMessageWithBackfilledAttempt(
  msgId: string,
  personaId: string,
  slug: string,
  idx: number,
  createdAt: number,
): Promise<void> {
  // Write both the messages row and the matching backfilled Run/
  // RunTarget/Attempt as the v14 migration would have produced.
  await sql.execute(
    `INSERT INTO messages (
       id, conversation_id, role, content, provider, model, persona_id,
       display_mode, pinned, pin_target, addressed_to, created_at, idx,
       error_message, error_transient, input_tokens, output_tokens, audience,
       ttft_ms, stream_ms
     ) VALUES (?, 'c_1', 'assistant', 'old reply', 'openai', 'gpt-4', ?, 'lines',
              0, NULL, '[]', ?, ?, NULL, 0, 0, 0, '[]', NULL, NULL)`,
    [msgId, personaId, createdAt, idx],
  );
  await sql.execute(
    `INSERT INTO runs (id, conversation_id, kind, started_at, completed_at)
     VALUES (?, 'c_1', 'send', ?, ?)`,
    [`run_${msgId}`, createdAt, createdAt],
  );
  await sql.execute(
    `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
     VALUES (?, ?, ?, ?, 'openai', 'gpt-4', 'complete')`,
    [`rt_${msgId}`, `run_${msgId}`, slug, personaId],
  );
  await sql.execute(
    `INSERT INTO attempts (id, run_target_id, sequence, content, started_at, completed_at,
                            error_message, error_transient, input_tokens, output_tokens,
                            ttft_ms, stream_ms, superseded_at)
     VALUES (?, ?, 1, 'old reply', ?, ?, NULL, 0, 0, 0, NULL, NULL, NULL)`,
    [`att_${msgId}`, `rt_${msgId}`, createdAt, createdAt],
  );
}

describe("recordReplay", () => {
  it("creates a kind=replay Run, supersedes prior Attempts, and records new Attempts", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_1", "alice");
    await seedPersona("p_2", "bob");
    await seedAssistantMessageWithBackfilledAttempt("m_old1", "p_1", "alice", 1, 2000);
    await seedAssistantMessageWithBackfilledAttempt("m_old2", "p_2", "bob", 2, 2100);

    await recordReplay({
      conversationId: "c_1",
      now: 5000,
      supersededMessageIds: ["m_old1", "m_old2"],
      newAssistantMessages: [
        {
          id: "m_new1",
          personaId: "p_1",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "new reply 1",
          createdAt: 5100,
          inputTokens: 5,
          outputTokens: 7,
          ttftMs: 50,
          streamMs: 200,
          errorMessage: null,
          errorTransient: false,
        },
        {
          id: "m_new2",
          personaId: "p_2",
          targetKey: "bob",
          provider: "openai",
          model: "gpt-4",
          content: "new reply 2",
          createdAt: 5150,
          inputTokens: 0,
          outputTokens: 0,
          ttftMs: null,
          streamMs: null,
          errorMessage: "boom",
          errorTransient: true,
        },
      ],
    });

    // A new Run with kind=replay
    const runs = await listRunsForConversation("c_1");
    const replayRuns = runs.filter((r) => r.kind === "replay");
    expect(replayRuns).toHaveLength(1);
    expect(replayRuns[0]?.startedAt).toBe(5000);
    expect(replayRuns[0]?.targets).toHaveLength(2);
    const targetKeys = replayRuns[0]?.targets.map((t) => t.targetKey).sort();
    expect(targetKeys).toEqual(["alice", "bob"]);

    // The two backfilled attempts are superseded
    const oldAtt1 = await listAttempts("rt_m_old1");
    expect(oldAtt1[0]?.supersededAt).toBe(5000);
    const oldAtt2 = await listAttempts("rt_m_old2");
    expect(oldAtt2[0]?.supersededAt).toBe(5000);

    // The new attempts attach to the replay run's targets and carry
    // the streamed content + timings.
    const aliceTarget = replayRuns[0]?.targets.find((t) => t.targetKey === "alice");
    const aliceAttempts = await listAttempts(aliceTarget!.id);
    expect(aliceAttempts).toHaveLength(1);
    expect(aliceAttempts[0]?.content).toBe("new reply 1");
    expect(aliceAttempts[0]?.inputTokens).toBe(5);
    expect(aliceAttempts[0]?.outputTokens).toBe(7);
    expect(aliceAttempts[0]?.ttftMs).toBe(50);
    expect(aliceAttempts[0]?.streamMs).toBe(200);

    const bobTarget = replayRuns[0]?.targets.find((t) => t.targetKey === "bob");
    const bobAttempts = await listAttempts(bobTarget!.id);
    expect(bobAttempts[0]?.errorMessage).toBe("boom");
    expect(bobAttempts[0]?.errorTransient).toBe(true);

    // Replay RunTarget status reflects the per-message outcome.
    expect(aliceTarget?.status).toBe("complete");
    expect(bobTarget?.status).toBe("error");
  });

  it("is a no-op when no messages were superseded and none created", async () => {
    handle = await createTestDb();
    await seedConversation();
    await recordReplay({
      conversationId: "c_1",
      now: 5000,
      supersededMessageIds: [],
      newAssistantMessages: [],
    });
    const runs = await listRunsForConversation("c_1");
    expect(runs.filter((r) => r.kind === "replay")).toHaveLength(0);
  });

  it("stamps flow_step_id on the replay run when supplied (#234)", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_1", "alice");
    // Seed a flow + personas-step so the FK lands on a real row.
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index, loop_start_index)
        VALUES ('f_1', 'c_1', 0, 0)`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind)
        VALUES ('fs_1', 'f_1', 1, 'personas')`,
    );

    await recordReplay({
      conversationId: "c_1",
      now: 5000,
      flowStepId: "fs_1",
      supersededMessageIds: [],
      newAssistantMessages: [
        {
          id: "m_replay",
          personaId: "p_1",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "fresh",
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
    expect(runs[0]?.flowStepId).toBe("fs_1");
  });

  it("leaves flow_step_id null on the replay run when not supplied (today's behavior) (#234)", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_1", "alice");

    await recordReplay({
      conversationId: "c_1",
      now: 5000,
      supersededMessageIds: [],
      newAssistantMessages: [
        {
          id: "m_replay",
          personaId: "p_1",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "fresh",
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
    expect(runs[0]?.flowStepId).toBeNull();
  });

  it("tolerates supersededMessageIds without backfilled attempts (defensive)", async () => {
    // Real edge case: messages created post-#175 won't have a
    // matching `att_<msgid>` row until the send/retry sub-issues land.
    // recordReplay must still complete the new-Run side cleanly.
    handle = await createTestDb();
    await seedConversation();
    await seedPersona("p_1", "alice");
    await recordReplay({
      conversationId: "c_1",
      now: 5000,
      supersededMessageIds: ["m_does_not_exist"],
      newAssistantMessages: [
        {
          id: "m_new",
          personaId: "p_1",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "fresh",
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
});
