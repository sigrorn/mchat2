// recordSend with flowStepId — slice 2 of #212 (#214).
//
// When a Run is dispatched as part of a conversation flow's `personas`
// step, the resulting `runs` row gets stamped with the active flow
// step's id. Without flowStepId the column stays null (today's
// behavior).
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { sql } from "@/lib/tauri/sql";
import { recordSend } from "@/lib/orchestration/recordSend";
import { listRunsForConversation } from "@/lib/persistence/runs";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversationWithFlow(): Promise<{ stepId: string }> {
  await sql.execute(
    `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode,
        visibility_matrix, selected_personas, context_warnings_fired)
      VALUES ('c_1', 't', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
  );
  await sql.execute(
    `INSERT INTO personas (id, conversation_id, provider, name, name_slug,
        created_at_message_index, sort_order, runs_after, visibility_defaults)
      VALUES ('p_alice', 'c_1', 'openai', 'Alice', 'alice', 0, 0, '[]', '{}')`,
  );
  await sql.execute(
    `INSERT INTO flows (id, conversation_id, current_step_index)
      VALUES ('f_1', 'c_1', 0)`,
  );
  await sql.execute(
    `INSERT INTO flow_steps (id, flow_id, sequence, kind)
      VALUES ('fs_1', 'f_1', 0, 'personas')`,
  );
  return { stepId: "fs_1" };
}

describe("recordSend.flowStepId (#214)", () => {
  it("stamps flow_step_id on the runs row when supplied", async () => {
    handle = await createTestDb();
    const { stepId } = await seedConversationWithFlow();
    await recordSend({
      conversationId: "c_1",
      now: 5000,
      flowStepId: stepId,
      newAssistantMessages: [
        {
          id: "m_1",
          personaId: "p_alice",
          targetKey: "alice",
          provider: "openai",
          model: "gpt-4",
          content: "hi",
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
    expect(runs[0]?.flowStepId).toBe(stepId);
  });

  it("leaves flow_step_id null when flowStepId is omitted (today's behavior)", async () => {
    handle = await createTestDb();
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode,
          visibility_matrix, selected_personas, context_warnings_fired)
        VALUES ('c_2', 't', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug,
          created_at_message_index, sort_order, runs_after, visibility_defaults)
        VALUES ('p_bob', 'c_2', 'openai', 'Bob', 'bob', 0, 0, '[]', '{}')`,
    );
    await recordSend({
      conversationId: "c_2",
      now: 5000,
      newAssistantMessages: [
        {
          id: "m_1",
          personaId: "p_bob",
          targetKey: "bob",
          provider: "openai",
          model: "gpt-4",
          content: "hi",
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
    const runs = await listRunsForConversation("c_2");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.flowStepId).toBeNull();
  });
});
