// Integration repro for the regression "//pop no longer removes
// messages" reported 2026-04-27. Exercises handlePop through
// createTestDb so we hit the real SQL + transaction machinery.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import * as messagesRepo from "@/lib/persistence/messages";
import * as conversationsRepo from "@/lib/persistence/conversations";
import * as flowsRepo from "@/lib/persistence/flows";
import { recordSend } from "@/lib/orchestration/recordSend";
import { sql } from "@/lib/tauri/sql";
import { handlePop } from "@/lib/commands/handlers/history";
import type { CommandContext } from "@/lib/commands/handlers/types";
import type { Conversation, Message } from "@/lib/types";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

async function seedConversation(): Promise<Conversation> {
  return conversationsRepo.createConversation({
    id: "c1",
    title: "t",
    systemPrompt: null,
    lastProvider: null,
    limitMarkIndex: null,
    displayMode: "lines",
    visibilityMode: "joined",
    visibilityMatrix: {},
    limitSizeTokens: null,
    selectedPersonas: [],
    compactionFloorIndex: null,
    autocompactThreshold: null,
    contextWarningsFired: [],
  });
}

async function seedTurn(conversationId: string, userText: string, assistantText: string): Promise<{ user: Message; assistant: Message }> {
  const user = await messagesRepo.appendMessage({
    conversationId,
    role: "user",
    content: userText,
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
  const assistant = await messagesRepo.appendMessage({
    conversationId,
    role: "assistant",
    content: assistantText,
    provider: "mock",
    model: "mock",
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
  return { user, assistant };
}

interface CtxRecorder {
  setSelectionCalls: Array<{ conversationId: string; selection: string[] }>;
  setFlowModeCalls: Array<{ conversationId: string; on: boolean }>;
}

function makeCtx(
  conv: Conversation,
  history: readonly Message[],
  recorder?: CtxRecorder,
): CommandContext {
  return {
    rawInput: "//pop",
    conversation: conv,
    retry: async () => ({ ok: true }),
    send: async () => ({ ok: true }),
    deps: {
      getMessages: () => history,
      getSupersededIds: () => new Set<string>(),
      getPersonas: () => [],
      getSelection: () => [],
      appendNotice: async (conversationId: string, content: string) =>
        messagesRepo.appendMessage({
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
      reloadMessages: async () => {},
      setPinned: async () => {},
      setEditing: () => {},
      setReplayQueue: () => {},
      setLimit: async () => {},
      setLimitSize: async () => {},
      setVisibilityPreset: async () => {},
      setVisibilityMatrix: async () => {},
      setDisplayMode: async () => {},
      // #232: flow read/write so handlePop can rewind the cursor.
      getFlow: (conversationId: string) => flowsRepo.getFlow(conversationId),
      setFlowStepIndex: async (flowId: string, index: number) => {
        await flowsRepo.setStepIndex(flowId, index);
      },
      // #233: observable so the selection-sync test can assert on calls.
      setFlowMode: async (conversationId: string, on: boolean) => {
        recorder?.setFlowModeCalls.push({ conversationId, on });
      },
      setSelection: (conversationId: string, selection: readonly string[]) => {
        recorder?.setSelectionCalls.push({
          conversationId,
          selection: [...selection],
        });
      },
    } as unknown as CommandContext["deps"],
  } as CommandContext;
}

async function seedPersona(conversationId: string): Promise<void> {
  await sql.execute(
    `INSERT INTO personas (id, conversation_id, provider, name, name_slug,
        created_at_message_index, sort_order, runs_after, visibility_defaults)
      VALUES ('p_alice', ?, 'openai', 'Alice', 'alice', 0, 0, '[]', '{}')`,
    [conversationId],
  );
}

// #232: seed a flow with steps [user, personas, user] and stamp the
// passed assistant message's run with flow_step_id pointing at the
// personas-step. Mirrors the production code path that recordSend
// follows in sendMessage's flow loop.
async function seedFlowWithStampedRun(
  conversationId: string,
  cursorAt: number,
  assistantMessage: Message,
): Promise<{ flowId: string; userStepId: string; personasStepId: string }> {
  await sql.execute(
    `INSERT INTO flows (id, conversation_id, current_step_index, loop_start_index)
      VALUES ('f_1', ?, ?, 0)`,
    [conversationId, cursorAt],
  );
  await sql.execute(
    `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_0', 'f_1', 0, 'user')`,
  );
  await sql.execute(
    `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_1', 'f_1', 1, 'personas')`,
  );
  await sql.execute(
    `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_2', 'f_1', 2, 'user')`,
  );
  await sql.execute(
    `INSERT INTO flow_step_personas (flow_step_id, persona_id) VALUES ('fs_1', 'p_alice')`,
  );
  await recordSend({
    conversationId,
    now: 5000,
    flowStepId: "fs_1",
    newAssistantMessages: [
      {
        id: assistantMessage.id,
        personaId: "p_alice",
        targetKey: "alice",
        provider: "openai",
        model: "gpt-4",
        content: assistantMessage.content,
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
  return { flowId: "f_1", userStepId: "fs_0", personasStepId: "fs_1" };
}

describe("//pop integration (#regression report 2026-04-27)", () => {
  it("removes the last user message and its assistant reply from the messages table", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedTurn(conv.id, "first", "first reply");
    const turn2 = await seedTurn(conv.id, "second", "second reply");
    const before = await messagesRepo.listMessages(conv.id);
    expect(before).toHaveLength(4);

    const ctx = makeCtx(conv, before);
    await handlePop(ctx, { userNumber: null });

    const after = await messagesRepo.listMessages(conv.id);
    // Both rows of turn2 must be gone; the notice replaces them.
    expect(after.find((m) => m.id === turn2.user.id)).toBeUndefined();
    expect(after.find((m) => m.id === turn2.assistant.id)).toBeUndefined();
    // First turn survives, plus the notice that //pop ran.
    expect(after.filter((m) => m.role === "notice")).toHaveLength(1);
    expect(after.filter((m) => m.role !== "notice")).toHaveLength(2);
  });
});

describe("//pop flow cursor rewind (#232)", () => {
  it("//pop (no arg) rewinds the cursor to the user-step that fed the popped personas-step", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedPersona(conv.id);
    const turn = await seedTurn(conv.id, "first", "first reply");
    // Cursor at fs_2 (user step that follows personas-step). The popped
    // assistant row was produced at fs_1; the rewind target is fs_0.
    await seedFlowWithStampedRun(conv.id, 2, turn.assistant);
    const before = await messagesRepo.listMessages(conv.id);

    const ctx = makeCtx(conv, before);
    await handlePop(ctx, { userNumber: null });

    const flow = await flowsRepo.getFlow(conv.id);
    expect(flow?.currentStepIndex).toBe(0);
  });

  it("//pop N rewinds the cursor to the user-step that fed the earliest popped personas-step", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedPersona(conv.id);
    const turn = await seedTurn(conv.id, "first", "first reply");
    await seedFlowWithStampedRun(conv.id, 2, turn.assistant);
    const before = await messagesRepo.listMessages(conv.id);
    // turn.user is the first non-pinned user message → user number 1.

    const ctx = makeCtx(conv, before);
    await handlePop(ctx, { userNumber: 1 });

    const flow = await flowsRepo.getFlow(conv.id);
    expect(flow?.currentStepIndex).toBe(0);
  });

  it("//pop with no flow attached is a no-op for the cursor (no flow to rewind)", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedTurn(conv.id, "first", "first reply");
    const before = await messagesRepo.listMessages(conv.id);

    const ctx = makeCtx(conv, before);
    await handlePop(ctx, { userNumber: null });

    const flow = await flowsRepo.getFlow(conv.id);
    expect(flow).toBeNull();
  });

  it("//pop leaves the cursor alone when popped assistants have no flow_step_id", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedPersona(conv.id);
    await seedTurn(conv.id, "first", "first reply");
    // Flow exists but the popped assistant row has no associated run
    // (assistant produced outside the flow path).
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index, loop_start_index)
        VALUES ('f_1', ?, 2, 0)`,
      [conv.id],
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_0', 'f_1', 0, 'user')`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_1', 'f_1', 1, 'personas')`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_2', 'f_1', 2, 'user')`,
    );
    const before = await messagesRepo.listMessages(conv.id);

    const ctx = makeCtx(conv, before);
    await handlePop(ctx, { userNumber: null });

    const flow = await flowsRepo.getFlow(conv.id);
    expect(flow?.currentStepIndex).toBe(2);
  });
});

describe("//pop syncs selection + flow_mode after rewind (#233)", () => {
  it("after //pop rewinds the cursor, selection is re-synced to the next personas-step's persona-set", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedPersona(conv.id);
    const turn = await seedTurn(conv.id, "first", "first reply");
    // Cursor lands at fs_2 (user step) after the personas-step ran. The
    // pre-pop selection is intentionally something other than the
    // expected re-synced value so we can prove the helper actually
    // overwrote it.
    await seedFlowWithStampedRun(conv.id, 2, turn.assistant);
    const before = await messagesRepo.listMessages(conv.id);

    const recorder: CtxRecorder = {
      setSelectionCalls: [],
      setFlowModeCalls: [],
    };
    const ctx = makeCtx(conv, before, recorder);
    await handlePop(ctx, { userNumber: null });

    // Cursor rewound to fs_0 (user-step). Next personas-step from there
    // is fs_1 = [p_alice]. Selection must be set to that.
    expect(recorder.setSelectionCalls).toContainEqual({
      conversationId: conv.id,
      selection: ["p_alice"],
    });
    expect(recorder.setFlowModeCalls).toContainEqual({
      conversationId: conv.id,
      on: true,
    });
  });

  it("//pop N also syncs selection + flow_mode after rewind", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedPersona(conv.id);
    const turn = await seedTurn(conv.id, "first", "first reply");
    await seedFlowWithStampedRun(conv.id, 2, turn.assistant);
    const before = await messagesRepo.listMessages(conv.id);

    const recorder: CtxRecorder = {
      setSelectionCalls: [],
      setFlowModeCalls: [],
    };
    const ctx = makeCtx(conv, before, recorder);
    await handlePop(ctx, { userNumber: 1 });

    expect(recorder.setSelectionCalls).toContainEqual({
      conversationId: conv.id,
      selection: ["p_alice"],
    });
    expect(recorder.setFlowModeCalls).toContainEqual({
      conversationId: conv.id,
      on: true,
    });
  });

  it("//pop with no flow attached does not sync selection or flow_mode", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedTurn(conv.id, "first", "first reply");
    const before = await messagesRepo.listMessages(conv.id);

    const recorder: CtxRecorder = {
      setSelectionCalls: [],
      setFlowModeCalls: [],
    };
    const ctx = makeCtx(conv, before, recorder);
    await handlePop(ctx, { userNumber: null });

    expect(recorder.setSelectionCalls).toHaveLength(0);
    expect(recorder.setFlowModeCalls).toHaveLength(0);
  });

  it("//pop leaves selection + flow_mode alone when popped assistants have no flow_step_id (no rewind happens)", async () => {
    handle = await createTestDb();
    const conv = await seedConversation();
    await seedPersona(conv.id);
    await seedTurn(conv.id, "first", "first reply");
    await sql.execute(
      `INSERT INTO flows (id, conversation_id, current_step_index, loop_start_index)
        VALUES ('f_1', ?, 2, 0)`,
      [conv.id],
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_0', 'f_1', 0, 'user')`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_1', 'f_1', 1, 'personas')`,
    );
    await sql.execute(
      `INSERT INTO flow_steps (id, flow_id, sequence, kind) VALUES ('fs_2', 'f_1', 2, 'user')`,
    );
    const before = await messagesRepo.listMessages(conv.id);

    const recorder: CtxRecorder = {
      setSelectionCalls: [],
      setFlowModeCalls: [],
    };
    const ctx = makeCtx(conv, before, recorder);
    await handlePop(ctx, { userNumber: null });

    expect(recorder.setSelectionCalls).toHaveLength(0);
    expect(recorder.setFlowModeCalls).toHaveLength(0);
  });
});
