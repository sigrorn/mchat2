// ------------------------------------------------------------------
// Component: Messages repository
// Responsibility: CRUD over Message rows. Owns monotonic index
//                 allocation — callers never set index themselves.
// Collaborators: orchestration/streamRunner.ts, context/builder.ts.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";
import type { Message, ProviderId, DisplayMode, Role } from "../types";
import { newMessageId } from "./ids";

interface Row {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  provider: string | null;
  model: string | null;
  persona_id: string | null;
  display_mode: string;
  pinned: number;
  pin_target: string | null;
  addressed_to: string;
  created_at: number;
  idx: number;
  error_message: string | null;
  error_transient: number;
  input_tokens?: number;
  output_tokens?: number;
  usage_estimated?: number;
  audience?: string;
}

function rowToMessage(r: Row): Message {
  let addressedTo: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.addressed_to);
    if (Array.isArray(parsed))
      addressedTo = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    addressedTo = [];
  }
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as Role,
    content: r.content,
    provider: (r.provider as ProviderId | null) ?? null,
    model: r.model,
    personaId: r.persona_id,
    displayMode: r.display_mode === "cols" ? "cols" : "lines",
    pinned: r.pinned !== 0,
    pinTarget: r.pin_target,
    addressedTo,
    createdAt: r.created_at,
    index: r.idx,
    errorMessage: r.error_message,
    errorTransient: r.error_transient !== 0,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    usageEstimated: (r.usage_estimated ?? 0) !== 0,
    audience: parseStringArray(r.audience ?? "[]"),
  };
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const rows = await sql.select<Row>(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY idx",
    [conversationId],
  );
  return rows.map(rowToMessage);
}

export async function getMessage(id: string): Promise<Message | null> {
  const rows = await sql.select<Row>("SELECT * FROM messages WHERE id = ?", [id]);
  return rows[0] ? rowToMessage(rows[0]) : null;
}

async function nextIndex(conversationId: string): Promise<number> {
  const rows = await sql.select<{ next: number | null }>(
    "SELECT COALESCE(MAX(idx) + 1, 0) AS next FROM messages WHERE conversation_id = ?",
    [conversationId],
  );
  return rows[0]?.next ?? 0;
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
  await sql.execute(
    `INSERT INTO messages
       (id, conversation_id, role, content, provider, model, persona_id,
        display_mode, pinned, pin_target, addressed_to, created_at, idx,
        error_message, error_transient, input_tokens, output_tokens,
        usage_estimated, audience)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      msg.id,
      msg.conversationId,
      msg.role,
      msg.content,
      msg.provider,
      msg.model,
      msg.personaId,
      msg.displayMode,
      msg.pinned ? 1 : 0,
      msg.pinTarget,
      JSON.stringify(msg.addressedTo),
      msg.createdAt,
      msg.index,
      msg.errorMessage,
      msg.errorTransient ? 1 : 0,
      msg.inputTokens,
      msg.outputTokens,
      msg.usageEstimated ? 1 : 0,
      JSON.stringify(msg.audience),
    ],
  );
  return msg;
}

// Used by streamRunner to flush accumulated text and final error state.
export async function updateMessageContent(
  id: string,
  content: string,
  errorMessage: string | null,
  errorTransient: boolean,
): Promise<void> {
  await sql.execute(
    "UPDATE messages SET content = ?, error_message = ?, error_transient = ? WHERE id = ?",
    [content, errorMessage, errorTransient ? 1 : 0, id],
  );
}

// Separate UPDATE so the big content flush and the small token-counts
// write can migrate independently (and so the streamRunner test can
// assert on the token-writing statement without grepping the same SQL).
export async function updateMessageUsage(
  id: string,
  inputTokens: number,
  outputTokens: number,
  usageEstimated: boolean,
): Promise<void> {
  await sql.execute(
    "UPDATE messages SET input_tokens = ?, output_tokens = ?, usage_estimated = ? WHERE id = ?",
    [inputTokens, outputTokens, usageEstimated ? 1 : 0, id],
  );
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
  const sets: string[] = [];
  const values: unknown[] = [];
  if (mutation.pinned !== undefined) {
    sets.push("pinned = ?");
    values.push(mutation.pinned ? 1 : 0);
  }
  if (mutation.pinTarget !== undefined) {
    sets.push("pin_target = ?");
    values.push(mutation.pinTarget);
  }
  if (mutation.addressedTo !== undefined) {
    sets.push("addressed_to = ?");
    values.push(JSON.stringify(mutation.addressedTo));
  }
  if (mutation.content !== undefined) {
    sets.push("content = ?");
    values.push(mutation.content);
  }
  if (sets.length === 0) return;
  values.push(mutation.id);
  await sql.execute(`UPDATE messages SET ${sets.join(", ")} WHERE id = ?`, values);
}

// Truncate the tail of a conversation — used by edit/replay (#44) to
// drop every row after the edited user message so the regenerated
// replies take their place.
export async function deleteMessagesAfter(
  conversationId: string,
  index: number,
): Promise<void> {
  await sql.execute("DELETE FROM messages WHERE conversation_id = ? AND idx > ?", [
    conversationId,
    index,
  ]);
}

export async function setMessagePin(
  id: string,
  pinned: boolean,
  pinTarget: string | null,
): Promise<void> {
  await sql.execute("UPDATE messages SET pinned = ?, pin_target = ? WHERE id = ?", [
    pinned ? 1 : 0,
    pinTarget,
    id,
  ]);
}

export async function deleteMessage(id: string): Promise<void> {
  await sql.execute("DELETE FROM messages WHERE id = ?", [id]);
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
  };
  return { ...base, ...overrides };
}
