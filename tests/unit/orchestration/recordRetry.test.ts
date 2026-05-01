// recordRetry — write a retry's side-effects to the new
// Run/RunTarget/Attempt model (#174 → #178). Reuses the failed
// message's RunTarget (backfilled as rt_<msgid>) so the retry's
// Attempt becomes sequence=2 on the same target. The failed
// Attempt gets superseded_at stamped.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import { recordRetry } from "@/lib/orchestration/recordRetry";
import { listAttempts } from "@/lib/persistence/runs";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversation(): Promise<void> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
     VALUES ('c_1', 'T', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
  );
}
async function seedPersona(): Promise<void> {
  await sql.execute(
    `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, visibility_defaults)
     VALUES ('p_1', 'c_1', 'openai', 'Alice', 'alice', 0, 0, '{}')`,
  );
}
async function seedFailedAssistantWithBackfill(msgId = "m_old"): Promise<void> {
  await sql.execute(
    `INSERT INTO messages (
       id, conversation_id, role, content, provider, model, persona_id,
       display_mode, pinned, pin_target, addressed_to, created_at, idx,
       error_message, error_transient, input_tokens, output_tokens, audience,
       ttft_ms, stream_ms
     ) VALUES (?, 'c_1', 'assistant', '(fail)', 'openai', 'gpt-4', 'p_1',
              'lines', 0, NULL, '[]', 2000, 1, 'rate limited', 1, 0, 0, '[]',
              NULL, NULL)`,
    [msgId],
  );
  await sql.execute(
    `INSERT INTO runs (id, conversation_id, kind, started_at, completed_at)
     VALUES (?, 'c_1', 'send', 2000, 2000)`,
    [`run_${msgId}`],
  );
  await sql.execute(
    `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
     VALUES (?, ?, 'alice', 'p_1', 'openai', 'gpt-4', 'error')`,
    [`rt_${msgId}`, `run_${msgId}`],
  );
  await sql.execute(
    `INSERT INTO attempts (id, run_target_id, sequence, content, started_at, completed_at,
                            error_message, error_transient, input_tokens, output_tokens,
                            ttft_ms, stream_ms, superseded_at)
     VALUES (?, ?, 1, '(fail)', 2000, 2000, 'rate limited', 1, 0, 0, NULL, NULL, NULL)`,
    [`att_${msgId}`, `rt_${msgId}`],
  );
}

describe("recordRetry", () => {
  it("supersedes the old attempt and appends a new attempt as sequence=2 on the same RunTarget", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    await seedFailedAssistantWithBackfill();

    await recordRetry({
      failedMessageId: "m_old",
      now: 5000,
      newAssistantMessage: {
        id: "m_new",
        content: "second try",
        createdAt: 5100,
        inputTokens: 12,
        outputTokens: 34,
        ttftMs: 80,
        streamMs: 220,
        errorMessage: null,
        errorTransient: false,
      },
    });

    const attempts = await listAttempts("rt_m_old");
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.sequence).toBe(1);
    expect(attempts[0]?.content).toBe("(fail)");
    expect(attempts[0]?.supersededAt).toBe(5000);
    expect(attempts[1]?.sequence).toBe(2);
    expect(attempts[1]?.content).toBe("second try");
    expect(attempts[1]?.inputTokens).toBe(12);
    expect(attempts[1]?.outputTokens).toBe(34);
    expect(attempts[1]?.ttftMs).toBe(80);
    expect(attempts[1]?.streamMs).toBe(220);
    expect(attempts[1]?.supersededAt).toBeNull();

    // RunTarget status flips from error → complete.
    const targetRow = await sql.select<{ status: string }>(
      "SELECT status FROM run_targets WHERE id = 'rt_m_old'",
    );
    expect(targetRow[0]?.status).toBe("complete");
  });

  it("flips RunTarget status to error when the retry itself errors", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    await seedFailedAssistantWithBackfill();
    await recordRetry({
      failedMessageId: "m_old",
      now: 5000,
      newAssistantMessage: {
        id: "m_new",
        content: "(still failed)",
        createdAt: 5100,
        inputTokens: 0,
        outputTokens: 0,
        ttftMs: null,
        streamMs: null,
        errorMessage: "still rate limited",
        errorTransient: true,
      },
    });
    const targetRow = await sql.select<{ status: string }>(
      "SELECT status FROM run_targets WHERE id = 'rt_m_old'",
    );
    expect(targetRow[0]?.status).toBe("error");
    const attempts = await listAttempts("rt_m_old");
    expect(attempts[1]?.errorMessage).toBe("still rate limited");
    expect(attempts[1]?.errorTransient).toBe(true);
  });

  it("is a defensive no-op when the failed message has no backfilled RunTarget", async () => {
    handle = await createTestDb();
    await seedConversation();
    // No seedFailedAssistantWithBackfill — m_postv175 represents a
    // message created after #175 but before #178 lands the matching
    // Attempt write at send time.
    await expect(
      recordRetry({
        failedMessageId: "m_postv175",
        now: 5000,
        newAssistantMessage: {
          id: "m_new",
          content: "fresh",
          createdAt: 5100,
          inputTokens: 0,
          outputTokens: 0,
          ttftMs: null,
          streamMs: null,
          errorMessage: null,
          errorTransient: false,
        },
      }),
    ).resolves.not.toThrow();
    // No new attempt rows created (since there's no target to attach to).
    const rows = await sql.select<{ id: string }>("SELECT id FROM attempts");
    expect(rows).toHaveLength(0);
  });
});
