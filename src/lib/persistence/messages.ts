// ------------------------------------------------------------------
// Component: Messages repository (Kysely-backed)
// Responsibility: CRUD over Message rows. Owns monotonic index
//                 allocation — callers never set index themselves.
// Collaborators: orchestration/streamRunner.ts, context/builder.ts.
// History:       Migrated from raw sql.execute / sql.select to
//                Kysely in #190. Public exports keep their
//                signatures; the hand-written `Row` interface is
//                gone — column types come from
//                lib/persistence/schema.ts.
// ------------------------------------------------------------------

import { sql, type Kysely } from "kysely";
import { db, makeKyselyFor } from "./db";
import { withSerializedSection } from "../tauri/sql";
import type { Database, MessagesTable } from "./schema";
import type { Message, ProviderId, DisplayMode, Role } from "../types";
import { newMessageId } from "./ids";
import { parseAddressedTo, parseAudience } from "../schemas/messageJsonColumns";

// #267: every repo function that may run inside a transaction takes an
// optional Kysely instance (default: the global queued `db`). When a
// transaction body calls a repo, it passes its own ctx.db (a Kysely
// bound to the raw, queue-bypassing impl) so the call doesn't deadlock
// waiting on the queue head the section already holds.

function rowToMessage(r: MessagesTable): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as Role,
    content: r.content,
    provider: (r.provider as ProviderId | null) ?? null,
    model: r.model,
    personaId: r.persona_id,
    displayMode: (r.display_mode === "cols" ? "cols" : "lines") as DisplayMode,
    pinned: r.pinned !== 0,
    pinTarget: r.pin_target,
    addressedTo: parseAddressedTo(r.addressed_to),
    createdAt: r.created_at,
    index: r.idx,
    errorMessage: r.error_message,
    errorTransient: r.error_transient !== 0,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    usageEstimated: r.usage_estimated !== 0,
    audience: parseAudience(r.audience),
    ttftMs: r.ttft_ms,
    streamMs: r.stream_ms,
    supersededAt: r.superseded_at,
    confirmedAt: r.confirmed_at,
    flowDispatched: r.flow_dispatched === 1,
    costUsd: r.cost_usd,
    hiddenByResetId: r.hidden_by_reset_id,
  };
}

function messageToRow(msg: Message): MessagesTable {
  return {
    id: msg.id,
    conversation_id: msg.conversationId,
    role: msg.role,
    content: msg.content,
    provider: msg.provider,
    model: msg.model,
    persona_id: msg.personaId,
    display_mode: msg.displayMode,
    pinned: msg.pinned ? 1 : 0,
    pin_target: msg.pinTarget,
    addressed_to: JSON.stringify(msg.addressedTo),
    created_at: msg.createdAt,
    idx: msg.index,
    error_message: msg.errorMessage,
    error_transient: msg.errorTransient ? 1 : 0,
    input_tokens: msg.inputTokens,
    output_tokens: msg.outputTokens,
    usage_estimated: msg.usageEstimated ? 1 : 0,
    audience: JSON.stringify(msg.audience),
    ttft_ms: msg.ttftMs ?? null,
    stream_ms: msg.streamMs ?? null,
    superseded_at: msg.supersededAt ?? null,
    confirmed_at: msg.confirmedAt ?? null,
    flow_dispatched: msg.flowDispatched ? 1 : 0,
    cost_usd: msg.costUsd ?? null,
    hidden_by_reset_id: msg.hiddenByResetId ?? null,
  };
}

export async function listMessages(
  conversationId: string,
  dbi: Kysely<Database> = db,
): Promise<Message[]> {
  const rows = await dbi
    .selectFrom("messages")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .orderBy("idx")
    .execute();
  return rows.map(rowToMessage);
}

export async function getMessage(id: string): Promise<Message | null> {
  const row = await db.selectFrom("messages").selectAll().where("id", "=", id).executeTakeFirst();
  return row ? rowToMessage(row) : null;
}

async function nextIndex(conversationId: string, dbi: Kysely<Database>): Promise<number> {
  const row = await dbi
    .selectFrom("messages")
    .select((eb) => eb.fn.coalesce(eb.fn.max("idx"), eb.lit(-1)).as("last"))
    .where("conversation_id", "=", conversationId)
    .executeTakeFirst();
  return (row?.last ?? -1) + 1;
}

// Per-conversation serialization of appendMessage. Without this, parallel
// DAG nodes all read the same MAX(idx)+1 before any has inserted and then
// collide on the (conversation_id, idx) unique index.
const appendChain: Map<string, Promise<unknown>> = new Map();

// index, id, createdAt are assigned here so callers never race on them.
// #267: when called inside a transaction, the caller passes ctx.db so the
// inserts go through the section's raw impl (otherwise they'd queue and
// deadlock waiting for the section that holds the queue head). Skips
// the appendChain AND the held-section wrap in that case — the caller's
// transaction already owns the queue; doAppend's three statements run
// through the section's chain (#274), preserving atomicity.
//
// #276: the non-transaction path now wraps the three statements
// (SELECT MAX(idx), INSERT, UPDATE conversations.last_message_at) in a
// withSerializedSection so no other top-level op can interleave between
// them. Pre-#276 a transaction() queued mid-call could BEGIN between
// MAX-read and INSERT, mutate the messages table, and leave appendMessage
// inserting at a stale idx (UNIQUE collision or wrong-position row).
// appendChain stays as a per-conversation FIFO so multiple async appends
// on the same conversation hit MAX-read in causal order; the section
// wrap then forces atomicity per call.
export async function appendMessage(
  partial: Omit<Message, "id" | "index" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
  dbi?: Kysely<Database>,
): Promise<Message> {
  if (dbi !== undefined) return doAppend(partial, dbi);
  const convId = partial.conversationId;
  const prev = appendChain.get(convId) ?? Promise.resolve();
  const next = prev.then(() =>
    withSerializedSection((raw) => doAppend(partial, makeKyselyFor(raw))),
  );
  appendChain.set(
    convId,
    next.catch(() => undefined),
  );
  return next;
}

async function doAppend(
  partial: Omit<Message, "id" | "index" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
  dbi: Kysely<Database>,
): Promise<Message> {
  const idx = await nextIndex(partial.conversationId, dbi);
  const msg: Message = {
    ...partial,
    id: partial.id ?? newMessageId(),
    index: idx,
    createdAt: partial.createdAt ?? Date.now(),
  };
  await dbi.insertInto("messages").values(messageToRow(msg)).execute();
  // #250: bump the conversation's last_message_at so the sidebar's
  // unread dot lights up the moment a new row lands. Done inline here
  // (rather than as a separate caller responsibility) so every code
  // path that produces messages — sends, replays, retries, notices,
  // streaming placeholders — stays in sync without extra plumbing.
  await dbi
    .updateTable("conversations")
    .set({ last_message_at: msg.createdAt })
    .where("id", "=", msg.conversationId)
    .execute();
  return msg;
}

// #278: bulk-append API for high-volume import paths (snapshotImport).
// Replaces N appendMessage calls with one MAX-read + ceil(N/BULK_BATCH)
// multi-row INSERTs + one last_message_at bump. Caller MUST be inside a
// transaction (dbi required) so the batch is atomic and there's no
// MAX-read-then-other-writer race.
//
// Chunked because SQLite has a default 999-parameter prepared-statement
// cap; multiplied by ~25 message columns, that lets ~40 rows fit per
// statement. We use BULK_BATCH = 100 — Tauri's plugin-sql ships modern
// SQLite (3.40+, 32k param cap) so the chunk size is set for clarity,
// not for the parameter ceiling.
const BULK_BATCH = 100;

export async function bulkAppendMessages(
  conversationId: string,
  partials: ReadonlyArray<
    Omit<Message, "id" | "index" | "createdAt"> & {
      id?: string;
      createdAt?: number;
    }
  >,
  dbi: Kysely<Database>,
): Promise<Message[]> {
  if (partials.length === 0) return [];
  const startIdx = await nextIndex(conversationId, dbi);
  const now = Date.now();
  const messages: Message[] = partials.map((partial, i) => ({
    ...partial,
    id: partial.id ?? newMessageId(),
    index: startIdx + i,
    createdAt: partial.createdAt ?? now,
  }));
  // Chunk into batches that respect the parameter cap.
  for (let i = 0; i < messages.length; i += BULK_BATCH) {
    const chunk = messages.slice(i, i + BULK_BATCH);
    await dbi.insertInto("messages").values(chunk.map(messageToRow)).execute();
  }
  // Single last_message_at bump using the latest createdAt — saves
  // N updates compared to the per-row appendMessage path.
  const lastCreatedAt = messages[messages.length - 1]!.createdAt;
  await dbi
    .updateTable("conversations")
    .set({ last_message_at: lastCreatedAt })
    .where("id", "=", conversationId)
    .execute();
  return messages;
}

export async function updateMessageContent(
  id: string,
  content: string,
  errorMessage: string | null,
  errorTransient: boolean,
  dbi?: Kysely<Database>,
): Promise<void> {
  if (dbi !== undefined) return doUpdateMessageContent(id, content, errorMessage, errorTransient, dbi);
  // #276: same shape as appendMessage's non-transaction path — three
  // statements (UPDATE messages, SELECT messages.conversation_id, UPDATE
  // conversations.last_message_at) wrapped in a held section so a
  // concurrent transaction can't interleave between them. Pre-#276 the
  // SELECT could see a different conversation_id than what was current
  // when the UPDATE landed if the row was deleted/moved between the
  // two queue positions.
  return withSerializedSection((raw) =>
    doUpdateMessageContent(id, content, errorMessage, errorTransient, makeKyselyFor(raw)),
  );
}

async function doUpdateMessageContent(
  id: string,
  content: string,
  errorMessage: string | null,
  errorTransient: boolean,
  dbi: Kysely<Database>,
): Promise<void> {
  await dbi
    .updateTable("messages")
    .set({ content, error_message: errorMessage, error_transient: errorTransient ? 1 : 0 })
    .where("id", "=", id)
    .execute();
  // #250: stream completion bumps the conversation's last_message_at
  // so the sidebar's unread dot lights up when an assistant reply
  // finishes streaming in a conversation the user has stepped away
  // from. The token-pump's per-batch patches don't bump the column
  // (DB cost), so this is the moment the user's "is the answer
  // ready?" signal lands.
  const row = await dbi
    .selectFrom("messages")
    .select(["conversation_id"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (row) {
    await dbi
      .updateTable("conversations")
      .set({ last_message_at: Date.now() })
      .where("id", "=", row.conversation_id)
      .execute();
  }
}

// #282: updateMessageUsage and updateMessageCost dropped — they were
// only called from streamRunner's finalization sequence, now folded
// into finalizeAssistantMessage.

// #253: minimal projection for the persona-panel spend table. Pulls
// only the columns the aggregator needs — provider, cost_usd,
// usage_estimated, created_at — so a multi-thousand-message DB
// doesn't ship full bodies up to the UI just to sum a few floats.
// Skips rows without a provider (user/system/notice rows). No
// conversation filter: spend tracking is global by design.
export interface SpendRowProjection {
  provider: ProviderId;
  costUsd: number | null;
  usageEstimated: boolean;
  createdAt: number;
}

export async function listSpendRows(): Promise<SpendRowProjection[]> {
  const rows = await db
    .selectFrom("messages")
    .select(["provider", "cost_usd", "usage_estimated", "created_at"])
    .where("role", "=", "assistant")
    .where("provider", "is not", null)
    .execute();
  return rows.map((r) => ({
    provider: r.provider as ProviderId,
    costUsd: r.cost_usd,
    usageEstimated: r.usage_estimated !== 0,
    createdAt: r.created_at,
  }));
}

// #282: stream-completion finalization. streamRunner used to issue
// 4-6 separate queued UPDATEs (content, usage, cost, timing) plus
// updateMessageContent's internal SELECT + UPDATE conversations
// pair — six round-trips per stream completion. With multi-persona
// sends fanning N parallel streams, the queue saturates fast.
//
// One UPDATE messages SET ... WHERE id = ? + one UPDATE conversations
// SET last_message_at = ? WHERE id = ? does the same work in two
// queued ops. Optional fields are skipped when undefined so a partial
// finalization (e.g. failed stream — no usage/timing) doesn't write
// zero-defaults over the placeholder's existing nulls.
export interface FinalizeAssistantMessageState {
  content: string;
  errorMessage: string | null;
  errorTransient: boolean;
  inputTokens?: number;
  outputTokens?: number;
  usageEstimated?: boolean;
  costUsd?: number | null;
  ttftMs?: number | null;
  streamMs?: number | null;
}

export async function finalizeAssistantMessage(
  id: string,
  state: FinalizeAssistantMessageState,
  dbi?: Kysely<Database>,
): Promise<void> {
  if (dbi !== undefined) return doFinalizeAssistantMessage(id, state, dbi);
  // Held section so the messages UPDATE + the conversations
  // last_message_at bump land as one atomic group (matches the same
  // shape as appendMessage's #276 wrap).
  return withSerializedSection((raw) =>
    doFinalizeAssistantMessage(id, state, makeKyselyFor(raw)),
  );
}

async function doFinalizeAssistantMessage(
  id: string,
  state: FinalizeAssistantMessageState,
  dbi: Kysely<Database>,
): Promise<void> {
  const updates: Partial<MessagesTable> = {
    content: state.content,
    error_message: state.errorMessage,
    error_transient: state.errorTransient ? 1 : 0,
  };
  if (state.inputTokens !== undefined) updates.input_tokens = state.inputTokens;
  if (state.outputTokens !== undefined) updates.output_tokens = state.outputTokens;
  if (state.usageEstimated !== undefined) {
    updates.usage_estimated = state.usageEstimated ? 1 : 0;
  }
  if (state.costUsd !== undefined) updates.cost_usd = state.costUsd;
  if (state.ttftMs !== undefined) updates.ttft_ms = state.ttftMs;
  if (state.streamMs !== undefined) updates.stream_ms = state.streamMs;
  await dbi
    .updateTable("messages")
    .set(updates)
    .where("id", "=", id)
    .execute();
  // Same #250 unread-dot bump as updateMessageContent — find the row's
  // conversation_id and stamp last_message_at. We need a SELECT here
  // because finalize is keyed by message id, not conversation id; the
  // alternative (caller passes conversation id) leaks knowledge that
  // doesn't belong in the streamRunner call site.
  const row = await dbi
    .selectFrom("messages")
    .select(["conversation_id"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (row) {
    await dbi
      .updateTable("conversations")
      .set({ last_message_at: Date.now() })
      .where("id", "=", row.conversation_id)
      .execute();
  }
}

// #282: updateMessageTiming dropped — folded into
// finalizeAssistantMessage along with usage and cost.

// Apply a partial mutation to a message row. Used by the persona-
// deletion cleanup and the edit/replay flow so callers can issue one
// UPDATE per affected row touching only the columns that changed.
export async function applyMessageMutation(
  mutation: {
    id: string;
    pinned?: boolean;
    pinTarget?: string | null;
    addressedTo?: string[];
    content?: string;
  },
  dbi: Kysely<Database> = db,
): Promise<void> {
  const updates: Partial<MessagesTable> = {};
  if (mutation.pinned !== undefined) updates.pinned = mutation.pinned ? 1 : 0;
  if (mutation.pinTarget !== undefined) updates.pin_target = mutation.pinTarget;
  if (mutation.addressedTo !== undefined)
    updates.addressed_to = JSON.stringify(mutation.addressedTo);
  if (mutation.content !== undefined) updates.content = mutation.content;
  if (Object.keys(updates).length === 0) return;
  await dbi.updateTable("messages").set(updates).where("id", "=", mutation.id).execute();
}

// Insert a message at an explicit `idx`. Caller must ensure the slot
// is free (typically after calling shiftMessageIndicesFrom to open a
// gap). Used by //compact -N (#110) to place the COMPACTION notice +
// summaries mid-conversation.
export async function insertMessageAtIndex(
  partial: Omit<Message, "id" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
  dbi: Kysely<Database> = db,
): Promise<Message> {
  const msg: Message = {
    ...partial,
    id: partial.id ?? newMessageId(),
    createdAt: partial.createdAt ?? Date.now(),
  };
  await dbi.insertInto("messages").values(messageToRow(msg)).execute();
  return msg;
}

// Shift `idx` values of all messages at-or-after `fromIdx` by `delta`
// within one conversation. Used by //compact -N (#110) to open a
// numbered gap for the inserted COMPACTION notice + summaries.
//
// Safety: SQLite validates the UNIQUE (conversation_id, idx) index
// after the whole UPDATE completes, not per-row, so `idx = idx + delta`
// is safe even though intermediate rows would collide mid-update.
//
// #268: rewritten as Kysely (sql template) so the optional dbi arg
// threads cleanly into transactions. Previously fell back to
// ourSql.execute, which couldn't bypass the queue from inside a
// transaction body.
export async function shiftMessageIndicesFrom(
  conversationId: string,
  fromIdx: number,
  delta: number,
  dbi: Kysely<Database> = db,
): Promise<void> {
  if (delta === 0) return;
  await dbi
    .updateTable("messages")
    .set({ idx: sql<number>`idx + ${delta}` })
    .where("conversation_id", "=", conversationId)
    .where("idx", ">=", fromIdx)
    .execute();
}

// Truncate the tail of a conversation — used by edit/replay (#44) to
// drop every row after the edited user message so the regenerated
// replies take their place.
export async function deleteMessagesAfter(
  conversationId: string,
  index: number,
  dbi: Kysely<Database> = db,
): Promise<void> {
  await dbi
    .deleteFrom("messages")
    .where("conversation_id", "=", conversationId)
    .where("idx", ">", index)
    .execute();
}

export async function setMessagePin(
  id: string,
  pinned: boolean,
  pinTarget: string | null,
): Promise<void> {
  await db
    .updateTable("messages")
    .set({ pinned: pinned ? 1 : 0, pin_target: pinTarget })
    .where("id", "=", id)
    .execute();
}

export async function deleteMessage(id: string): Promise<void> {
  await db.deleteFrom("messages").where("id", "=", id).execute();
}

// #229: stamp messages.confirmed_at so the renderer hides the row
// (notice confirm-and-hide). Caller is expected to only invoke this
// for role === "notice" rows; the repo itself doesn't enforce that
// because there's no harm in confirming any row, but UI gates it.
export async function setMessageConfirmed(id: string, at: number): Promise<void> {
  await db
    .updateTable("messages")
    .set({ confirmed_at: at })
    .where("id", "=", id)
    .execute();
}

// #206: stamp messages.superseded_at so the UI's filterSupersededMessages
// hides these rows without removing them from the DB. Used by replay
// (the trailing assistant rows after the edited user message) and
// retry (the failed assistant row that's been replaced). The row
// stays in the messages table so the attempt-history affordance
// (#181) can surface it.
export async function markMessagesSuperseded(
  ids: readonly string[],
  at: number,
  dbi: Kysely<Database> = db,
): Promise<void> {
  if (ids.length === 0) return;
  await dbi
    .updateTable("messages")
    .set({ superseded_at: at })
    .where("id", "in", ids)
    .execute();
}

// #294: stamp messages with a fresh reset-event id, hiding every row
// past `boundary` in this conversation that isn't already hidden.
// Returns the allocated reset id and the count of rows touched. The
// caller computes `boundary` (the highest idx that should remain
// visible) — this function is content-blind. -1 means "hide everything
// in the conversation". Already-hidden rows keep their prior id so a
// future color-coded export can distinguish reset events.
export async function applyReset(
  conversationId: string,
  boundary: number,
  dbi: Kysely<Database> = db,
): Promise<{ resetId: number; hiddenCount: number }> {
  const maxRow = await dbi
    .selectFrom("messages")
    .select((eb) => eb.fn.coalesce(eb.fn.max("hidden_by_reset_id"), eb.lit(0)).as("m"))
    .where("conversation_id", "=", conversationId)
    .executeTakeFirst();
  const resetId = (maxRow?.m ?? 0) + 1;
  const result = await dbi
    .updateTable("messages")
    .set({ hidden_by_reset_id: resetId })
    .where("conversation_id", "=", conversationId)
    .where("idx", ">", boundary)
    .where("hidden_by_reset_id", "is", null)
    .executeTakeFirst();
  const hiddenCount = Number(result.numUpdatedRows ?? 0);
  return { resetId, hiddenCount };
}

// #181: superseded predecessors of `messageId` in the same
// conversation, grouped by persona_id (or provider when persona_id
// is null — bare-provider sends), ordered by index. Replaces
// listAttemptHistoryForMessage's attempt-id-keyed path that returned
// nothing for the #179-#205 random-id window. Reads
// messages.superseded_at directly so it works for ALL data.
export async function listMessageHistory(
  conversationId: string,
  messageId: string,
): Promise<Message[]> {
  const current = await getMessage(messageId);
  if (!current || current.conversationId !== conversationId) return [];
  let q = db
    .selectFrom("messages")
    .selectAll()
    .where("conversation_id", "=", conversationId)
    .where("superseded_at", "is not", null)
    .where("idx", "<", current.index);
  // Group by persona when the current message has one; fall back to
  // matching provider for bare-provider rows. Mixing personas would
  // surface unrelated history (e.g. bob's prior reply under alice's
  // bubble), which is the wrong UX.
  if (current.personaId !== null) {
    q = q.where("persona_id", "=", current.personaId);
  } else if (current.provider !== null) {
    q = q.where("persona_id", "is", null).where("provider", "=", current.provider);
  } else {
    q = q.where("persona_id", "is", null).where("provider", "is", null);
  }
  const rows = await q.orderBy("idx").execute();
  return rows.map(rowToMessage);
}

// Helper for test fixtures — build a Message without hitting the DB.
export function makeMessage(overrides: Partial<Message> & { conversationId: string }): Message {
  const base: Message = {
    id: newMessageId(),
    conversationId: overrides.conversationId,
    role: "user" satisfies Role,
    content: "",
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines" satisfies DisplayMode,
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    createdAt: 0,
    index: 0,
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
    ttftMs: null,
    streamMs: null,
  };
  return { ...base, ...overrides };
}
