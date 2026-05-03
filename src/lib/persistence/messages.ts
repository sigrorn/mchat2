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

import { sql as ourSql } from "../tauri/sql";
import { db } from "./db";
import type { MessagesTable } from "./schema";
import type { Message, ProviderId, DisplayMode, Role } from "../types";
import { newMessageId } from "./ids";
import { parseAddressedTo, parseAudience } from "../schemas/messageJsonColumns";

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
  };
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const rows = await db
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

async function nextIndex(conversationId: string): Promise<number> {
  const row = await db
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
export async function appendMessage(
  partial: Omit<Message, "id" | "index" | "createdAt"> & {
    id?: string;
    createdAt?: number;
  },
): Promise<Message> {
  const convId = partial.conversationId;
  const prev = appendChain.get(convId) ?? Promise.resolve();
  const next = prev.then(() => doAppend(partial));
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
): Promise<Message> {
  const idx = await nextIndex(partial.conversationId);
  const msg: Message = {
    ...partial,
    id: partial.id ?? newMessageId(),
    index: idx,
    createdAt: partial.createdAt ?? Date.now(),
  };
  await db.insertInto("messages").values(messageToRow(msg)).execute();
  // #250: bump the conversation's last_message_at so the sidebar's
  // unread dot lights up the moment a new row lands. Done inline here
  // (rather than as a separate caller responsibility) so every code
  // path that produces messages — sends, replays, retries, notices,
  // streaming placeholders — stays in sync without extra plumbing.
  await db
    .updateTable("conversations")
    .set({ last_message_at: msg.createdAt })
    .where("id", "=", msg.conversationId)
    .execute();
  return msg;
}

export async function updateMessageContent(
  id: string,
  content: string,
  errorMessage: string | null,
  errorTransient: boolean,
): Promise<void> {
  await db
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
  const row = await db
    .selectFrom("messages")
    .select(["conversation_id"])
    .where("id", "=", id)
    .executeTakeFirst();
  if (row) {
    await db
      .updateTable("conversations")
      .set({ last_message_at: Date.now() })
      .where("id", "=", row.conversation_id)
      .execute();
  }
}

export async function updateMessageUsage(
  id: string,
  inputTokens: number,
  outputTokens: number,
  usageEstimated: boolean,
): Promise<void> {
  await db
    .updateTable("messages")
    .set({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      usage_estimated: usageEstimated ? 1 : 0,
    })
    .where("id", "=", id)
    .execute();
}

// #122 — record streaming timings on successful stream completion.
// Not called for failed/cancelled streams (their timings stay NULL,
// which excludes them from //stats averages).
export async function updateMessageTiming(
  id: string,
  ttftMs: number,
  streamMs: number,
): Promise<void> {
  await db
    .updateTable("messages")
    .set({ ttft_ms: ttftMs, stream_ms: streamMs })
    .where("id", "=", id)
    .execute();
}

// Apply a partial mutation to a message row. Used by the persona-
// deletion cleanup and the edit/replay flow so callers can issue one
// UPDATE per affected row touching only the columns that changed.
export async function applyMessageMutation(mutation: {
  id: string;
  pinned?: boolean;
  pinTarget?: string | null;
  addressedTo?: string[];
  content?: string;
}): Promise<void> {
  const updates: Partial<MessagesTable> = {};
  if (mutation.pinned !== undefined) updates.pinned = mutation.pinned ? 1 : 0;
  if (mutation.pinTarget !== undefined) updates.pin_target = mutation.pinTarget;
  if (mutation.addressedTo !== undefined)
    updates.addressed_to = JSON.stringify(mutation.addressedTo);
  if (mutation.content !== undefined) updates.content = mutation.content;
  if (Object.keys(updates).length === 0) return;
  await db.updateTable("messages").set(updates).where("id", "=", mutation.id).execute();
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
): Promise<Message> {
  const msg: Message = {
    ...partial,
    id: partial.id ?? newMessageId(),
    createdAt: partial.createdAt ?? Date.now(),
  };
  await db.insertInto("messages").values(messageToRow(msg)).execute();
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
// Implementation note: SET idx = idx + delta needs a column self-
// reference. Falls back to ourSql.execute for this one case to avoid
// a tag-template dance for a single-line UPDATE.
export async function shiftMessageIndicesFrom(
  conversationId: string,
  fromIdx: number,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  await ourSql.execute(
    "UPDATE messages SET idx = idx + ? WHERE conversation_id = ? AND idx >= ?",
    [delta, conversationId, fromIdx],
  );
}

// Truncate the tail of a conversation — used by edit/replay (#44) to
// drop every row after the edited user message so the regenerated
// replies take their place.
export async function deleteMessagesAfter(conversationId: string, index: number): Promise<void> {
  await db
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
): Promise<void> {
  if (ids.length === 0) return;
  await db
    .updateTable("messages")
    .set({ superseded_at: at })
    .where("id", "in", ids)
    .execute();
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
