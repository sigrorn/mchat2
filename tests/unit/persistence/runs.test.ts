// Repo round-trip + zod boundary tests for the Run/RunTarget/Attempt
// model (#174 → #176). Asserts:
// - createRun / addRunTarget / appendAttempt persist and round-trip
// - appendAttempt auto-increments sequence per run_target
// - markSuperseded stamps superseded_at
// - markRunTargetStatus updates status
// - listRunsForConversation orders by started_at
// - row schemas are validated at the persistence boundary (junk data
//   in the DB does not crash the load path)

import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import {
  createRun,
  addRunTarget,
  appendAttempt,
  markSuperseded,
  markRunTargetStatus,
  getRun,
  listRunsForConversation,
  listAttempts,
  listSupersededMessageIds,
} from "@/lib/persistence/runs";
import { sql } from "@/lib/tauri/sql";

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

async function seedPersona(id = "p_1"): Promise<void> {
  await sql.execute(
    `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
     VALUES (?, 'c_1', 'openai', 'Alice', 'alice', 0, 0, '[]', '{}')`,
    [id],
  );
}

describe("runs repo — round-trip", () => {
  it("createRun persists and getRun returns the same shape", async () => {
    handle = await createTestDb();
    await seedConversation();
    const run = await createRun({
      conversationId: "c_1",
      kind: "send",
      replacementPolicy: { kind: "append" },
      startedAt: 5000,
    });
    expect(run.id).toMatch(/^run_/);
    const fetched = await getRun(run.id);
    expect(fetched).toEqual(run);
  });

  it("addRunTarget links to the run and reads back", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    const run = await createRun({
      conversationId: "c_1",
      kind: "send",
      replacementPolicy: { kind: "append" },
      startedAt: 5000,
    });
    const target = await addRunTarget({
      runId: run.id,
      targetKey: "alice",
      personaId: "p_1",
      provider: "openai",
      model: "gpt-4",
      status: "queued",
    });
    expect(target.id).toMatch(/^rt_/);
    const fetched = await getRun(run.id);
    expect(fetched?.targets).toHaveLength(1);
    expect(fetched?.targets[0]?.personaId).toBe("p_1");
    expect(fetched?.targets[0]?.targetKey).toBe("alice");
    expect(fetched?.targets[0]?.status).toBe("queued");
  });

  it("appendAttempt assigns sequence 1, 2, 3 in order", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    const run = await createRun({
      conversationId: "c_1",
      kind: "retry",
      replacementPolicy: { kind: "supersede" },
      startedAt: 5000,
    });
    const target = await addRunTarget({
      runId: run.id,
      targetKey: "alice",
      personaId: "p_1",
      provider: "openai",
      model: "gpt-4",
      status: "streaming",
    });
    const a1 = await appendAttempt({ runTargetId: target.id, content: "first", startedAt: 5100 });
    const a2 = await appendAttempt({ runTargetId: target.id, content: "second", startedAt: 5200 });
    const a3 = await appendAttempt({ runTargetId: target.id, content: "third", startedAt: 5300 });
    expect(a1.sequence).toBe(1);
    expect(a2.sequence).toBe(2);
    expect(a3.sequence).toBe(3);
    const attempts = await listAttempts(target.id);
    expect(attempts.map((a) => a.sequence)).toEqual([1, 2, 3]);
    expect(attempts.map((a) => a.content)).toEqual(["first", "second", "third"]);
  });

  it("markSuperseded stamps superseded_at and leaves the row otherwise intact", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    const run = await createRun({
      conversationId: "c_1",
      kind: "retry",
      replacementPolicy: { kind: "supersede" },
      startedAt: 5000,
    });
    const target = await addRunTarget({
      runId: run.id,
      targetKey: "alice",
      personaId: "p_1",
      provider: "openai",
      model: "gpt-4",
      status: "complete",
    });
    const att = await appendAttempt({ runTargetId: target.id, content: "old", startedAt: 5100 });
    await markSuperseded(att.id, 5500);
    const attempts = await listAttempts(target.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.supersededAt).toBe(5500);
    expect(attempts[0]?.content).toBe("old");
  });

  it("markRunTargetStatus updates the status column", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    const run = await createRun({
      conversationId: "c_1",
      kind: "send",
      replacementPolicy: { kind: "append" },
      startedAt: 5000,
    });
    const target = await addRunTarget({
      runId: run.id,
      targetKey: "alice",
      personaId: "p_1",
      provider: "openai",
      model: "gpt-4",
      status: "queued",
    });
    await markRunTargetStatus(target.id, "streaming");
    let fetched = await getRun(run.id);
    expect(fetched?.targets[0]?.status).toBe("streaming");
    await markRunTargetStatus(target.id, "complete");
    fetched = await getRun(run.id);
    expect(fetched?.targets[0]?.status).toBe("complete");
  });

  it("listRunsForConversation orders by started_at ascending", async () => {
    handle = await createTestDb();
    await seedConversation();
    const r1 = await createRun({
      conversationId: "c_1",
      kind: "send",
      replacementPolicy: { kind: "append" },
      startedAt: 9000,
    });
    const r2 = await createRun({
      conversationId: "c_1",
      kind: "retry",
      replacementPolicy: { kind: "supersede" },
      startedAt: 5000,
    });
    const r3 = await createRun({
      conversationId: "c_1",
      kind: "replay",
      replacementPolicy: { kind: "supersede" },
      startedAt: 7000,
    });
    const ids = (await listRunsForConversation("c_1")).map((r) => r.id);
    expect(ids).toEqual([r2.id, r3.id, r1.id]);
  });
});

describe("runs repo — listSupersededMessageIds (#180)", () => {
  it("returns ids of messages whose att_<msgid> Attempt has superseded_at set", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    // Two RunTargets in two backfilled-style Runs; one attempt is
    // superseded, the other is current.
    await sql.execute(
      `INSERT INTO runs (id, conversation_id, kind, started_at) VALUES ('run_a', 'c_1', 'send', 1)`,
    );
    await sql.execute(
      `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
       VALUES ('rt_a', 'run_a', 'alice', 'p_1', 'openai', 'gpt-4', 'complete')`,
    );
    await sql.execute(
      `INSERT INTO attempts (id, run_target_id, sequence, content, started_at, superseded_at,
                              error_transient, input_tokens, output_tokens)
       VALUES ('att_m1', 'rt_a', 1, 'old', 1, 99, 0, 0, 0),
              ('att_m2', 'rt_a', 2, 'new', 2, NULL, 0, 0, 0)`,
    );
    const ids = await listSupersededMessageIds("c_1");
    expect(ids.has("m1")).toBe(true);
    expect(ids.has("m2")).toBe(false);
    expect(ids.size).toBe(1);
  });

  it("scopes by conversation", async () => {
    handle = await createTestDb();
    await seedConversation("c_1");
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES ('c_2', 'Other', 1000, 'lines', 'separated', '{}', '[]', '[]')`,
    );
    await seedPersona();
    await sql.execute(
      `INSERT INTO runs (id, conversation_id, kind, started_at) VALUES ('run_other', 'c_2', 'send', 1)`,
    );
    await sql.execute(
      `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
       VALUES ('rt_other', 'run_other', 'alice', 'p_1', 'openai', 'gpt-4', 'complete')`,
    );
    await sql.execute(
      `INSERT INTO attempts (id, run_target_id, sequence, content, started_at, superseded_at,
                              error_transient, input_tokens, output_tokens)
       VALUES ('att_other', 'rt_other', 1, 'old', 1, 99, 0, 0, 0)`,
    );
    const ids = await listSupersededMessageIds("c_1");
    expect(ids.size).toBe(0);
  });

  it("ignores attempts whose ids do NOT match the att_<msgid> convention", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    await sql.execute(
      `INSERT INTO runs (id, conversation_id, kind, started_at) VALUES ('run_a', 'c_1', 'send', 1)`,
    );
    await sql.execute(
      `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
       VALUES ('rt_a', 'run_a', 'alice', 'p_1', 'openai', 'gpt-4', 'complete')`,
    );
    // appendAttempt-generated id (no message linkage)
    await sql.execute(
      `INSERT INTO attempts (id, run_target_id, sequence, content, started_at, superseded_at,
                              error_transient, input_tokens, output_tokens)
       VALUES ('att_xyz123', 'rt_a', 1, 'old', 1, 99, 0, 0, 0)`,
    );
    const ids = await listSupersededMessageIds("c_1");
    // 'xyz123' is NOT a real message id — backfill rows use att_<actualMsgId>
    // and recordRetry/recordReplay also follow the pattern. A free-form
    // appendAttempt id has no message to filter, so it is included
    // but won't match anything in the messages table. (No-op in
    // practice but documented here so future readers know the
    // limitation.)
    expect(ids.has("xyz123")).toBe(true);
  });
});

describe("runs repo — boundary parsing", () => {
  it("rejects unknown run.kind via zod (does not silently coerce)", async () => {
    handle = await createTestDb();
    await seedConversation();
    // Insert a row directly with a junk kind — bypassing the typed
    // helper. The load path must surface a parse error rather than
    // returning a row that violates the RunKind union.
    await sql.execute(
      `INSERT INTO runs (id, conversation_id, kind, started_at) VALUES ('run_x', 'c_1', 'totally-bogus', 1)`,
    );
    await expect(getRun("run_x")).rejects.toThrow();
  });

  it("rejects unknown run_target.status via zod", async () => {
    handle = await createTestDb();
    await seedConversation();
    await seedPersona();
    const run = await createRun({
      conversationId: "c_1",
      kind: "send",
      replacementPolicy: { kind: "append" },
      startedAt: 5000,
    });
    await sql.execute(
      `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
       VALUES ('rt_bad', ?, 'alice', 'p_1', 'openai', 'gpt-4', 'gibberish')`,
      [run.id],
    );
    await expect(getRun(run.id)).rejects.toThrow();
  });
});
