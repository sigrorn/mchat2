// ------------------------------------------------------------------
// Component: Runs repository
// Responsibility: CRUD over runs / run_targets / attempts (#174 → #176).
//                 First-class persistence for the orchestration state
//                 machine. Orchestration code (replay/retry/send) calls
//                 these helpers instead of editing the messages table.
// Collaborators: lib/orchestration/* (callers), lib/schemas/runs (zod).
// History:       Migrated to Kysely in #209, continuing the arc started
//                by #190 (messages) and #191 (conversations). Zod
//                row-validation is retained because the kind/status
//                enum constraints aren't representable in schema.ts —
//                the boundary tests in tests/unit/persistence/runs.test
//                pin that behavior.
// ------------------------------------------------------------------

import { db } from "./db";
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
    flowStepId: r.flow_step_id ?? null,
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
  // #215: optional flow step that triggered this run. Stamped when
  // the run was dispatched as part of a conversation flow's
  // `personas` step.
  flowStepId?: string | null;
}): Promise<Run> {
  const id = input.id ?? newRunId();
  const startedAt = input.startedAt ?? Date.now();
  await db
    .insertInto("runs")
    .values({
      id,
      conversation_id: input.conversationId,
      kind: input.kind,
      started_at: startedAt,
      completed_at: null,
      flow_step_id: input.flowStepId ?? null,
    })
    .execute();
  return {
    id,
    conversationId: input.conversationId,
    kind: input.kind,
    replacementPolicy: input.replacementPolicy ?? defaultPolicyFor(input.kind),
    startedAt,
    completedAt: null,
    flowStepId: input.flowStepId ?? null,
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
  await db
    .insertInto("run_targets")
    .values({
      id,
      run_id: input.runId,
      target_key: input.targetKey,
      persona_id: input.personaId,
      provider: input.provider,
      model: input.model,
      status: input.status,
    })
    .execute();
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
  const row = await db
    .selectFrom("attempts")
    .select((eb) => eb.fn.coalesce(eb.fn.max("sequence"), eb.lit(0)).as("max"))
    .where("run_target_id", "=", input.runTargetId)
    .executeTakeFirst();
  const sequence = (row?.max ?? 0) + 1;
  const id = input.id ?? newAttemptId();
  const startedAt = input.startedAt ?? Date.now();
  await db
    .insertInto("attempts")
    .values({
      id,
      run_target_id: input.runTargetId,
      sequence,
      content: input.content,
      started_at: startedAt,
      completed_at: input.completedAt ?? null,
      error_message: input.errorMessage ?? null,
      error_transient: input.errorTransient ? 1 : 0,
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      ttft_ms: input.ttftMs ?? null,
      stream_ms: input.streamMs ?? null,
      superseded_at: null,
    })
    .execute();
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
  await db
    .updateTable("attempts")
    .set({ superseded_at: at })
    .where("id", "=", attemptId)
    .execute();
}

export async function markRunTargetStatus(
  runTargetId: string,
  status: RunTargetStatus,
): Promise<void> {
  await db
    .updateTable("run_targets")
    .set({ status })
    .where("id", "=", runTargetId)
    .execute();
}

export async function getRun(id: string): Promise<Run | null> {
  const runRow = await db
    .selectFrom("runs")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  if (!runRow) return null;
  const targetRows = await db
    .selectFrom("run_targets")
    .selectAll()
    .where("run_id", "=", id)
    .orderBy("rowid" as never)
    .execute();
  return mapRun(runRow, targetRows);
}

export async function listRunsForConversation(conversationId: string): Promise<Run[]> {
  const runRows = await db
    .selectFrom("runs")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .orderBy("started_at")
    .execute();
  // One target query per run keeps this simple; if a conversation
  // grows to thousands of runs the inner loop becomes the obvious
  // optimization candidate (single GROUP_CONCAT or in-memory join).
  const out: Run[] = [];
  for (const r of runRows) {
    const targetRows = await db
      .selectFrom("run_targets")
      .selectAll()
      .where("run_id", "=", r.id)
      .orderBy("rowid" as never)
      .execute();
    out.push(mapRun(r, targetRows));
  }
  return out;
}

export async function listAttempts(runTargetId: string): Promise<Attempt[]> {
  const rows = await db
    .selectFrom("attempts")
    .selectAll()
    .where("run_target_id", "=", runTargetId)
    .orderBy("sequence")
    .execute();
  return rows.map(mapAttempt);
}

// #180 → #206: returns the set of message ids that are currently
// superseded (replaced by a later replay/retry). Reads
// messages.superseded_at directly so the result is correct
// regardless of whether the underlying attempts have the
// att_<msgid> id convention (only reliable post-#205) or a random
// id from the #179-#205 window. attempts.superseded_at retains
// its per-attempt-history meaning for the future #181 affordance.
export async function listSupersededMessageIds(conversationId: string): Promise<Set<string>> {
  const rows = await db
    .selectFrom("messages")
    .select("id")
    .where("conversation_id", "=", conversationId)
    .where("superseded_at", "is not", null)
    .execute();
  const out = new Set<string>();
  for (const r of rows) out.add(r.id);
  return out;
}
