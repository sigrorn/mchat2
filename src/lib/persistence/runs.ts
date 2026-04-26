// ------------------------------------------------------------------
// Component: Runs repository
// Responsibility: CRUD over runs / run_targets / attempts (#174 → #176).
//                 First-class persistence for the orchestration state
//                 machine. Orchestration code (replay/retry/send) calls
//                 these helpers instead of editing the messages table.
// Collaborators: lib/orchestration/* (callers), lib/schemas/runs (zod).
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";
import {
  attemptRowSchema,
  runRowSchema,
  runTargetRowSchema,
} from "../schemas/runs";
import type {
  Attempt,
  ReplacementPolicy,
  Run,
  RunKind,
  RunTarget,
  RunTargetStatus,
} from "../types/run";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
function randId(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  return out;
}
const newRunId = (): string => `run_${randId(10)}`;
const newRunTargetId = (): string => `rt_${randId(10)}`;
const newAttemptId = (): string => `att_${randId(10)}`;

// ReplacementPolicy is a runtime concept derived from RunKind: send
// appends, retry/replay supersede the previous attempt, compaction
// appends a new run without disturbing prior content. Persisting it
// would duplicate state that's already encoded in `kind`. If the
// product later needs an explicit override (e.g. retry-without-
// supersede), promote this to a stored column at that point.
function defaultPolicyFor(kind: RunKind): ReplacementPolicy {
  switch (kind) {
    case "retry":
    case "replay":
      return { kind: "supersede" };
    case "send":
    case "compaction":
      return { kind: "append" };
  }
}

function mapRun(rawRun: unknown, rawTargets: unknown[]): Run {
  const r = runRowSchema.parse(rawRun);
  const targets = rawTargets.map((rt) => mapRunTarget(rt));
  return {
    id: r.id,
    conversationId: r.conversation_id,
    kind: r.kind,
    replacementPolicy: defaultPolicyFor(r.kind),
    startedAt: r.started_at,
    completedAt: r.completed_at,
    targets,
  };
}

function mapRunTarget(raw: unknown): RunTarget {
  const r = runTargetRowSchema.parse(raw);
  return {
    id: r.id,
    runId: r.run_id,
    targetKey: r.target_key,
    personaId: r.persona_id,
    provider: r.provider,
    model: r.model,
    status: r.status,
  };
}

function mapAttempt(raw: unknown): Attempt {
  const r = attemptRowSchema.parse(raw);
  return {
    id: r.id,
    runTargetId: r.run_target_id,
    sequence: r.sequence,
    content: r.content,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    errorMessage: r.error_message,
    errorTransient: r.error_transient !== 0,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    ttftMs: r.ttft_ms,
    streamMs: r.stream_ms,
    supersededAt: r.superseded_at,
  };
}

export async function createRun(input: {
  conversationId: string;
  kind: RunKind;
  replacementPolicy?: ReplacementPolicy;
  startedAt?: number;
  id?: string;
}): Promise<Run> {
  const id = input.id ?? newRunId();
  const startedAt = input.startedAt ?? Date.now();
  await sql.execute(
    `INSERT INTO runs (id, conversation_id, kind, started_at, completed_at)
     VALUES (?, ?, ?, ?, NULL)`,
    [id, input.conversationId, input.kind, startedAt],
  );
  return {
    id,
    conversationId: input.conversationId,
    kind: input.kind,
    replacementPolicy: input.replacementPolicy ?? defaultPolicyFor(input.kind),
    startedAt,
    completedAt: null,
    targets: [],
  };
}

export async function addRunTarget(input: {
  runId: string;
  targetKey: string;
  personaId: string | null;
  provider: string | null;
  model: string | null;
  status: RunTargetStatus;
  id?: string;
}): Promise<RunTarget> {
  const id = input.id ?? newRunTargetId();
  await sql.execute(
    `INSERT INTO run_targets (id, run_id, target_key, persona_id, provider, model, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.runId, input.targetKey, input.personaId, input.provider, input.model, input.status],
  );
  return {
    id,
    runId: input.runId,
    targetKey: input.targetKey,
    personaId: input.personaId,
    provider: input.provider,
    model: input.model,
    status: input.status,
  };
}

// Sequence is allocated server-side as MAX(sequence)+1 within the
// target. Concurrent appends on the same RunTarget are not expected
// (one stream at a time per target); a future change that introduces
// parallelism on a single target needs a per-target lock or a
// transaction with SELECT ... FOR UPDATE-equivalent semantics.
export async function appendAttempt(input: {
  runTargetId: string;
  content: string;
  startedAt?: number;
  completedAt?: number | null;
  errorMessage?: string | null;
  errorTransient?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  ttftMs?: number | null;
  streamMs?: number | null;
  id?: string;
}): Promise<Attempt> {
  const rows = await sql.select<{ next: number | null }>(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM attempts WHERE run_target_id = ?",
    [input.runTargetId],
  );
  const sequence = rows[0]?.next ?? 1;
  const id = input.id ?? newAttemptId();
  const startedAt = input.startedAt ?? Date.now();
  await sql.execute(
    `INSERT INTO attempts (
       id, run_target_id, sequence, content, started_at, completed_at,
       error_message, error_transient, input_tokens, output_tokens,
       ttft_ms, stream_ms, superseded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      input.runTargetId,
      sequence,
      input.content,
      startedAt,
      input.completedAt ?? null,
      input.errorMessage ?? null,
      input.errorTransient ? 1 : 0,
      input.inputTokens ?? 0,
      input.outputTokens ?? 0,
      input.ttftMs ?? null,
      input.streamMs ?? null,
    ],
  );
  return {
    id,
    runTargetId: input.runTargetId,
    sequence,
    content: input.content,
    startedAt,
    completedAt: input.completedAt ?? null,
    errorMessage: input.errorMessage ?? null,
    errorTransient: input.errorTransient ?? false,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    ttftMs: input.ttftMs ?? null,
    streamMs: input.streamMs ?? null,
    supersededAt: null,
  };
}

export async function markSuperseded(attemptId: string, at: number): Promise<void> {
  await sql.execute("UPDATE attempts SET superseded_at = ? WHERE id = ?", [at, attemptId]);
}

export async function markRunTargetStatus(
  runTargetId: string,
  status: RunTargetStatus,
): Promise<void> {
  await sql.execute("UPDATE run_targets SET status = ? WHERE id = ?", [status, runTargetId]);
}

export async function getRun(id: string): Promise<Run | null> {
  const runRows = await sql.select<unknown>("SELECT * FROM runs WHERE id = ?", [id]);
  if (runRows.length === 0) return null;
  const targetRows = await sql.select<unknown>(
    "SELECT * FROM run_targets WHERE run_id = ? ORDER BY rowid",
    [id],
  );
  return mapRun(runRows[0], targetRows);
}

export async function listRunsForConversation(conversationId: string): Promise<Run[]> {
  const runRows = await sql.select<unknown>(
    "SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at",
    [conversationId],
  );
  // One target query per run keeps this simple; if a conversation
  // grows to thousands of runs the inner loop becomes the obvious
  // optimization candidate (single GROUP_CONCAT or in-memory join).
  const out: Run[] = [];
  for (const r of runRows) {
    const id = (r as { id: string }).id;
    const targetRows = await sql.select<unknown>(
      "SELECT * FROM run_targets WHERE run_id = ? ORDER BY rowid",
      [id],
    );
    out.push(mapRun(r, targetRows));
  }
  return out;
}

export async function listAttempts(runTargetId: string): Promise<Attempt[]> {
  const rows = await sql.select<unknown>(
    "SELECT * FROM attempts WHERE run_target_id = ? ORDER BY sequence",
    [runTargetId],
  );
  return rows.map(mapAttempt);
}

// #181: superseded sibling attempts on the same target_key as the
// given message's RunTarget. Per-target_key (not per-RunTarget) so
// replay's new RunTarget can still surface the prior send's history
// under the same persona. Returns [] when the message has no
// att_<msgid> backing or no superseded siblings exist.
export async function listAttemptHistoryForMessage(
  conversationId: string,
  messageId: string,
): Promise<Attempt[]> {
  const targetKeyRows = await sql.select<{ target_key: string }>(
    `SELECT rt.target_key AS target_key
       FROM attempts a
       JOIN run_targets rt ON rt.id = a.run_target_id
       JOIN runs r ON r.id = rt.run_id
      WHERE a.id = ? AND r.conversation_id = ?`,
    [`att_${messageId}`, conversationId],
  );
  const targetKey = targetKeyRows[0]?.target_key;
  if (!targetKey) return [];
  const rows = await sql.select<unknown>(
    `SELECT a.*
       FROM attempts a
       JOIN run_targets rt ON rt.id = a.run_target_id
       JOIN runs r ON r.id = rt.run_id
      WHERE r.conversation_id = ?
        AND rt.target_key = ?
        AND a.superseded_at IS NOT NULL
        AND a.id <> ?
      ORDER BY a.sequence`,
    [conversationId, targetKey, `att_${messageId}`],
  );
  return rows.map(mapAttempt);
}

// #180: returns the set of message ids whose Attempt has been
// superseded. Relies on the v14 backfill convention (att_<msgid>)
// and the recordSend/Retry/Replay convention (also att_-prefixed).
// Free-form appendAttempt ids that don't correspond to a message
// are silently included by their suffix; they're harmless because
// they can't match any messages.id in practice.
export async function listSupersededMessageIds(conversationId: string): Promise<Set<string>> {
  const rows = await sql.select<{ id: string }>(
    `SELECT a.id AS id
       FROM attempts a
       JOIN run_targets rt ON rt.id = a.run_target_id
       JOIN runs r ON r.id = rt.run_id
      WHERE r.conversation_id = ?
        AND a.superseded_at IS NOT NULL`,
    [conversationId],
  );
  const out = new Set<string>();
  for (const r of rows) {
    if (r.id.startsWith("att_")) out.add(r.id.slice(4));
  }
  return out;
}
