// ------------------------------------------------------------------
// Component: Conversations repository
// Responsibility: Persist and load Conversation rows.
// Collaborators: stores/conversations.ts, migrations.ts, ids.ts.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";
import type { AutocompactThreshold, Conversation, ProviderId } from "../types";
import { newConversationId } from "./ids";

interface Row {
  id: string;
  title: string;
  system_prompt: string | null;
  created_at: number;
  last_provider: string | null;
  limit_mark_index: number | null;
  display_mode: string;
  visibility_mode: string;
  visibility_matrix?: string;
  limit_size_tokens?: number | null;
  selected_personas?: string;
  compaction_floor_index?: number | null;
  autocompact_threshold?: string | null;
  context_warnings_fired?: string;
}

function rowToConversation(r: Row): Conversation {
  return {
    id: r.id,
    title: r.title,
    systemPrompt: r.system_prompt,
    createdAt: r.created_at,
    lastProvider: (r.last_provider as ProviderId | null) ?? null,
    limitMarkIndex: r.limit_mark_index,
    displayMode: r.display_mode === "cols" ? "cols" : "lines",
    visibilityMode: r.visibility_mode === "joined" ? "joined" : "separated",
    visibilityMatrix: parseMatrix(r.visibility_matrix ?? "{}"),
    limitSizeTokens: r.limit_size_tokens ?? null,
    selectedPersonas: parseStringArray(r.selected_personas ?? "[]"),
    compactionFloorIndex: r.compaction_floor_index ?? null,
    autocompactThreshold: parseAutocompactThreshold(r.autocompact_threshold ?? null),
    contextWarningsFired: parseNumberArray(r.context_warnings_fired ?? "[]"),
  };
}

export async function listConversations(): Promise<Conversation[]> {
  const rows = await sql.select<Row>("SELECT * FROM conversations ORDER BY created_at DESC");
  return rows.map(rowToConversation);
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const rows = await sql.select<Row>("SELECT * FROM conversations WHERE id = ?", [id]);
  return rows[0] ? rowToConversation(rows[0]) : null;
}

export async function createConversation(
  partial: Omit<Conversation, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<Conversation> {
  const conv: Conversation = {
    ...partial,
    id: partial.id ?? newConversationId(),
    createdAt: partial.createdAt ?? Date.now(),
  };
  await sql.execute(
    `INSERT INTO conversations
       (id, title, system_prompt, created_at, last_provider,
        limit_mark_index, display_mode, visibility_mode, visibility_matrix,
        limit_size_tokens, selected_personas, compaction_floor_index,
        autocompact_threshold, context_warnings_fired)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conv.id,
      conv.title,
      conv.systemPrompt,
      conv.createdAt,
      conv.lastProvider,
      conv.limitMarkIndex,
      conv.displayMode,
      conv.visibilityMode,
      JSON.stringify(conv.visibilityMatrix),
      conv.limitSizeTokens,
      JSON.stringify(conv.selectedPersonas),
      conv.compactionFloorIndex,
      conv.autocompactThreshold ? JSON.stringify(conv.autocompactThreshold) : null,
      JSON.stringify(conv.contextWarningsFired ?? []),
    ],
  );
  return conv;
}

export async function updateConversation(conv: Conversation): Promise<void> {
  await sql.execute(
    `UPDATE conversations SET
       title = ?, system_prompt = ?, last_provider = ?,
       limit_mark_index = ?, display_mode = ?, visibility_mode = ?,
       visibility_matrix = ?, limit_size_tokens = ?,
       selected_personas = ?, compaction_floor_index = ?,
       autocompact_threshold = ?, context_warnings_fired = ?
     WHERE id = ?`,
    [
      conv.title,
      conv.systemPrompt,
      conv.lastProvider,
      conv.limitMarkIndex,
      conv.displayMode,
      conv.visibilityMode,
      JSON.stringify(conv.visibilityMatrix),
      conv.limitSizeTokens,
      JSON.stringify(conv.selectedPersonas),
      conv.compactionFloorIndex,
      conv.autocompactThreshold ? JSON.stringify(conv.autocompactThreshold) : null,
      JSON.stringify(conv.contextWarningsFired ?? []),
      conv.id,
    ],
  );
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

function parseMatrix(raw: string): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        out[k] = v.filter((x): x is string => typeof x === "string");
      }
    }
    return out;
  } catch {
    return {};
  }
}

function parseAutocompactThreshold(raw: string | null): AutocompactThreshold | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (
      (obj.mode === "kTokens" || obj.mode === "percent") &&
      typeof obj.value === "number" &&
      obj.value > 0
    ) {
      const result: AutocompactThreshold = { mode: obj.mode, value: obj.value };
      if (typeof obj.preserve === "number" && obj.preserve > 0) {
        result.preserve = obj.preserve;
      }
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === "number");
  } catch {
    return [];
  }
}

export async function deleteConversation(id: string): Promise<void> {
  await sql.execute("DELETE FROM conversations WHERE id = ?", [id]);
}
