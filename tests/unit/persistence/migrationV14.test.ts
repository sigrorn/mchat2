// Migration v14 — runs / run_targets / attempts tables + 1:1:1 backfill
// from existing assistant messages (#174 → #175).
//
// Why backfill: every historical assistant message will be reachable
// through the new Run/RunTarget/Attempt model. Each row becomes one
// Run × one RunTarget × one Attempt. User rows are skipped — the new
// tables only describe model invocations.
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDbHandle } from "@/lib/testing/createTestDb";
import { MIGRATIONS } from "@/lib/persistence/migrations";
import { sql } from "@/lib/tauri/sql";

let handle: TestDbHandle | null = null;
afterEach(() => {
  handle?.restore();
  handle = null;
});

describe("migration v14 — Run/RunTarget/Attempt schema", () => {
  it("is the 14th migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(14);
  });

  it("creates the runs table", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(runs)");
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("conversation_id");
    expect(names).toContain("kind");
    expect(names).toContain("started_at");
    expect(names).toContain("completed_at");
  });

  it("creates the run_targets table", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(run_targets)");
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("run_id");
    expect(names).toContain("target_key");
    expect(names).toContain("persona_id");
    expect(names).toContain("provider");
    expect(names).toContain("model");
    expect(names).toContain("status");
  });

  it("creates the attempts table", async () => {
    handle = await createTestDb();
    const cols = await sql.select<{ name: string }>("PRAGMA table_info(attempts)");
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("run_target_id");
    expect(names).toContain("sequence");
    expect(names).toContain("content");
    expect(names).toContain("started_at");
    expect(names).toContain("completed_at");
    expect(names).toContain("error_message");
    expect(names).toContain("error_transient");
    expect(names).toContain("input_tokens");
    expect(names).toContain("output_tokens");
    expect(names).toContain("ttft_ms");
    expect(names).toContain("stream_ms");
    expect(names).toContain("superseded_at");
  });

  it("creates indexes on the new tables", async () => {
    handle = await createTestDb();
    const idx = await sql.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index'",
    );
    const names = idx.map((i) => i.name);
    expect(names).toContain("idx_runs_conv");
    expect(names).toContain("idx_run_targets_run");
    expect(names).toContain("idx_attempts_run_target");
  });
});

describe("migration v14 — backfill from existing assistant messages", () => {
  async function seedConversation(): Promise<void> {
    await sql.execute(
      `INSERT INTO conversations (id, title, created_at, display_mode, visibility_mode, visibility_matrix, selected_personas, context_warnings_fired)
       VALUES (?, ?, ?, 'lines', 'separated', '{}', '[]', '[]')`,
      ["c_1", "T", 1000],
    );
  }
  async function seedPersona(id: string, slug: string): Promise<void> {
    await sql.execute(
      `INSERT INTO personas (id, conversation_id, provider, name, name_slug, created_at_message_index, sort_order, runs_after, visibility_defaults)
       VALUES (?, 'c_1', 'openai', ?, ?, 0, 0, '[]', '{}')`,
      [id, slug, slug],
    );
  }
  async function seedMessage(
    id: string,
    role: "user" | "assistant",
    opts: {
      personaId?: string | null;
      provider?: string | null;
      model?: string | null;
      content?: string;
      createdAt?: number;
      idx: number;
      errorMessage?: string | null;
      errorTransient?: boolean;
      inputTokens?: number;
      outputTokens?: number;
      ttftMs?: number | null;
      streamMs?: number | null;
    },
  ): Promise<void> {
    await sql.execute(
      `INSERT INTO messages (
         id, conversation_id, role, content, provider, model, persona_id,
         display_mode, pinned, pin_target, addressed_to, created_at, idx,
         error_message, error_transient, input_tokens, output_tokens, audience,
         ttft_ms, stream_ms
       ) VALUES (?, 'c_1', ?, ?, ?, ?, ?, 'lines', 0, NULL, '[]', ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
      [
        id,
        role,
        opts.content ?? "hi",
        opts.provider ?? null,
        opts.model ?? null,
        opts.personaId ?? null,
        opts.createdAt ?? 2000,
        opts.idx,
        opts.errorMessage ?? null,
        opts.errorTransient ? 1 : 0,
        opts.inputTokens ?? 0,
        opts.outputTokens ?? 0,
        opts.ttftMs ?? null,
        opts.streamMs ?? null,
      ],
    );
  }

  it("creates one Run × one RunTarget × one Attempt per assistant message; user rows are skipped", async () => {
    // Seed at v13 (one before the new migration) to mimic an upgrading
    // database with real legacy rows in place when v14 runs.
    handle = await createTestDb({ stopAt: 13 });
    await seedConversation();
    await seedPersona("p_1", "alice");
    await seedMessage("m_user", "user", { idx: 0 });
    await seedMessage("m_a1", "assistant", {
      personaId: "p_1",
      provider: "openai",
      model: "gpt-4",
      content: "hello world",
      createdAt: 2222,
      idx: 1,
      inputTokens: 10,
      outputTokens: 20,
      ttftMs: 100,
      streamMs: 250,
    });
    await seedMessage("m_a2", "assistant", {
      personaId: "p_1",
      provider: "openai",
      model: "gpt-4",
      content: "(failed)",
      createdAt: 3333,
      idx: 2,
      errorMessage: "rate limited",
      errorTransient: true,
    });
    // Now apply migration v14.
    await handle.runRemainingMigrations();

    const runs = await sql.select<{ id: string; conversation_id: string; kind: string; started_at: number }>(
      "SELECT id, conversation_id, kind, started_at FROM runs ORDER BY started_at",
    );
    expect(runs).toHaveLength(2);
    expect(runs[0]!.conversation_id).toBe("c_1");
    expect(runs[0]!.kind).toBe("send");
    expect(runs[0]!.started_at).toBe(2222);
    expect(runs[1]!.started_at).toBe(3333);

    const targets = await sql.select<{
      run_id: string;
      target_key: string;
      persona_id: string;
      provider: string;
      model: string;
      status: string;
    }>("SELECT run_id, target_key, persona_id, provider, model, status FROM run_targets ORDER BY run_id");
    expect(targets).toHaveLength(2);
    const t1 = targets.find((t) => t.run_id === runs[0]!.id)!;
    expect(t1.persona_id).toBe("p_1");
    expect(t1.provider).toBe("openai");
    expect(t1.model).toBe("gpt-4");
    expect(t1.status).toBe("complete");
    expect(t1.target_key).toBe("alice"); // backfill uses persona name_slug
    const t2 = targets.find((t) => t.run_id === runs[1]!.id)!;
    expect(t2.status).toBe("error");

    const attempts = await sql.select<{
      run_target_id: string;
      sequence: number;
      content: string;
      input_tokens: number;
      output_tokens: number;
      ttft_ms: number | null;
      stream_ms: number | null;
      superseded_at: number | null;
      error_message: string | null;
      error_transient: number;
    }>(
      `SELECT run_target_id, sequence, content, input_tokens, output_tokens,
              ttft_ms, stream_ms, superseded_at, error_message, error_transient
         FROM attempts ORDER BY started_at`,
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.sequence).toBe(1);
    expect(attempts[0]!.content).toBe("hello world");
    expect(attempts[0]!.input_tokens).toBe(10);
    expect(attempts[0]!.output_tokens).toBe(20);
    expect(attempts[0]!.ttft_ms).toBe(100);
    expect(attempts[0]!.stream_ms).toBe(250);
    expect(attempts[0]!.superseded_at).toBeNull();
    expect(attempts[1]!.error_message).toBe("rate limited");
    expect(attempts[1]!.error_transient).toBe(1);
  });

  it("skips assistant messages without a persona (orphaned rows)", async () => {
    handle = await createTestDb({ stopAt: 13 });
    await seedConversation();
    await seedMessage("m_orphan", "assistant", {
      personaId: null,
      provider: "openai",
      model: "gpt-4",
      idx: 0,
    });
    await handle.runRemainingMigrations();
    const runs = await sql.select<{ id: string }>("SELECT id FROM runs");
    expect(runs).toHaveLength(0);
  });

  it("backfills 0 rows for an empty database", async () => {
    handle = await createTestDb();
    const runs = await sql.select<{ id: string }>("SELECT id FROM runs");
    const targets = await sql.select<{ id: string }>("SELECT id FROM run_targets");
    const attempts = await sql.select<{ id: string }>("SELECT id FROM attempts");
    expect(runs).toHaveLength(0);
    expect(targets).toHaveLength(0);
    expect(attempts).toHaveLength(0);
  });
});
