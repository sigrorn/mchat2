// ------------------------------------------------------------------
// Component: Conversations repository
// Responsibility: Persist and load Conversation rows.
// Collaborators: stores/conversations.ts, migrations.ts, ids.ts.
// ------------------------------------------------------------------

import { sql } from "../tauri/sql";
import type { Conversation, ProviderId } from "../types";
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
  };
}

export async function listConversations(): Promise<Conversation[]> {
  const rows = await sql.select<Row>(
    "SELECT * FROM conversations ORDER BY created_at DESC",
  );
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
        limit_mark_index, display_mode, visibility_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conv.id,
      conv.title,
      conv.systemPrompt,
      conv.createdAt,
      conv.lastProvider,
      conv.limitMarkIndex,
      conv.displayMode,
      conv.visibilityMode,
    ],
  );
  return conv;
}

export async function updateConversation(conv: Conversation): Promise<void> {
  await sql.execute(
    `UPDATE conversations SET
       title = ?, system_prompt = ?, last_provider = ?,
       limit_mark_index = ?, display_mode = ?, visibility_mode = ?
     WHERE id = ?`,
    [
      conv.title,
      conv.systemPrompt,
      conv.lastProvider,
      conv.limitMarkIndex,
      conv.displayMode,
      conv.visibilityMode,
      conv.id,
    ],
  );
}

export async function deleteConversation(id: string): Promise<void> {
  await sql.execute("DELETE FROM conversations WHERE id = ?", [id]);
}
