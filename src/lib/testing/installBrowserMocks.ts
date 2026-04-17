// ------------------------------------------------------------------
// Component: Browser mock installer
// Responsibility: Wire every lib/tauri/* module to an in-memory fake
//                 when running outside the Tauri webview. Powers the
//                 Playwright E2E suite and plain `vite dev` browsing
//                 for design work.
// Collaborators: lib/tauri/*, providers/registryOfAdapters (swaps in
//                mock adapter for all providers).
// ------------------------------------------------------------------

import { __setImpl as setSql } from "../tauri/sql";
import { __setImpl as setKc } from "../tauri/keychain";
import { __setImpl as setFs } from "../tauri/filesystem";
import { __setImpl as setLc } from "../tauri/lifecycle";

// --- in-memory SQL ---------------------------------------------------
// Not a real SQLite implementation. We back the three tables we
// actually use from the UI (conversations, personas, messages,
// settings) with object storage and hand-match the 20 or so queries
// the repos issue. It is enough for a smoke-level E2E.

type MemRow = Record<string, unknown>;
interface MemTable {
  name: string;
  rows: MemRow[];
}

function memSql() {
  const conversations: MemTable = { name: "conversations", rows: [] };
  const personas: MemTable = { name: "personas", rows: [] };
  const messages: MemTable = { name: "messages", rows: [] };
  const settings: MemTable = { name: "settings", rows: [] };
  let userVersion = 0;

  setSql({
    async execute(q, params = []) {
      const p = params as unknown[];
      if (/PRAGMA user_version\s*=\s*(\d+)/i.test(q)) {
        userVersion = Number(/user_version\s*=\s*(\d+)/i.exec(q)?.[1] ?? 0);
        return { rowsAffected: 0, lastInsertId: null };
      }
      if (
        /^PRAGMA /i.test(q) ||
        /^CREATE /i.test(q) ||
        /^DROP /i.test(q) ||
        /^ALTER TABLE/i.test(q)
      ) {
        return { rowsAffected: 0, lastInsertId: null };
      }

      if (/^INSERT INTO conversations/.test(q)) {
        insertNamed(conversations, CONV_COLS, p);
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^UPDATE conversations SET/.test(q)) {
        updateBy(conversations, CONV_UPDATE_COLS, p);
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^DELETE FROM conversations/.test(q)) {
        conversations.rows = conversations.rows.filter((r) => r.id !== p[0]);
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^INSERT INTO personas/.test(q)) {
        insertNamed(personas, PERSONA_COLS, p);
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^UPDATE personas SET deleted_at/.test(q)) {
        const r = personas.rows.find((x) => x.id === p[1]);
        if (r) r.deleted_at = p[0];
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^INSERT INTO messages/.test(q)) {
        insertNamed(messages, MSG_COLS, p);
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^UPDATE messages SET content/.test(q)) {
        const r = messages.rows.find((x) => x.id === p[3]);
        if (r) {
          r.content = p[0];
          r.error_message = p[1];
          r.error_transient = p[2];
        }
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^UPDATE messages SET input_tokens/.test(q)) {
        const r = messages.rows.find((x) => x.id === p[3]);
        if (r) {
          r.input_tokens = p[0];
          r.output_tokens = p[1];
          r.usage_estimated = p[2];
        }
        return { rowsAffected: 1, lastInsertId: null };
      }
      if (/^ALTER TABLE messages/.test(q)) {
        return { rowsAffected: 0, lastInsertId: null };
      }
      if (/^INSERT INTO settings/.test(q)) {
        const [key, value] = p as [string, string];
        const r = settings.rows.find((x) => x.key === key);
        if (r) r.value = value;
        else settings.rows.push({ key, value });
        return { rowsAffected: 1, lastInsertId: null };
      }
      return { rowsAffected: 0, lastInsertId: null };
    },
    async select<T>(q: string, params: unknown[] = []): Promise<T[]> {
      if (/PRAGMA user_version/i.test(q)) {
        return [{ user_version: userVersion } as unknown as T];
      }
      if (/FROM conversations WHERE id = \?/.test(q)) {
        return conversations.rows.filter((r) => r.id === params[0]) as unknown as T[];
      }
      if (/FROM conversations ORDER BY/.test(q)) {
        return [...conversations.rows].sort(
          (a, b) => Number(b.created_at) - Number(a.created_at),
        ) as unknown as T[];
      }
      if (/FROM personas WHERE id = \?/.test(q)) {
        return personas.rows.filter((r) => r.id === params[0]) as unknown as T[];
      }
      if (/FROM personas WHERE conversation_id = \?/.test(q)) {
        const active = q.includes("deleted_at IS NULL");
        return personas.rows.filter(
          (r) => r.conversation_id === params[0] && (!active || r.deleted_at === null),
        ) as unknown as T[];
      }
      if (/FROM messages WHERE conversation_id = \?/.test(q) && q.includes("ORDER BY idx")) {
        return [...messages.rows]
          .filter((r) => r.conversation_id === params[0])
          .sort((a, b) => Number(a.idx) - Number(b.idx)) as unknown as T[];
      }
      if (/FROM messages WHERE id = \?/.test(q)) {
        return messages.rows.filter((r) => r.id === params[0]) as unknown as T[];
      }
      if (/MAX\(idx\)/.test(q)) {
        const rows = messages.rows.filter((r) => r.conversation_id === params[0]);
        const max = rows.reduce((m, r) => Math.max(m, Number(r.idx)), -1);
        return [{ next: max + 1 } as unknown as T];
      }
      if (/FROM settings WHERE key = \?/.test(q)) {
        return settings.rows.filter((r) => r.key === params[0]) as unknown as T[];
      }
      return [];
    },
    async close() {},
  });
}

const CONV_COLS = [
  "id",
  "title",
  "system_prompt",
  "created_at",
  "last_provider",
  "limit_mark_index",
  "display_mode",
  "visibility_mode",
  "visibility_matrix",
  "limit_size_tokens",
  "selected_personas",
];
const CONV_UPDATE_COLS = [
  "title",
  "system_prompt",
  "last_provider",
  "limit_mark_index",
  "display_mode",
  "visibility_mode",
  "visibility_matrix",
  "limit_size_tokens",
  "selected_personas",
  "id",
];
const PERSONA_COLS = [
  "id",
  "conversation_id",
  "provider",
  "name",
  "name_slug",
  "system_prompt_override",
  "model_override",
  "color_override",
  "created_at_message_index",
  "sort_order",
  "runs_after",
  "deleted_at",
  "apertus_product_id",
];
const MSG_COLS = [
  "id",
  "conversation_id",
  "role",
  "content",
  "provider",
  "model",
  "persona_id",
  "display_mode",
  "pinned",
  "pin_target",
  "addressed_to",
  "created_at",
  "idx",
  "error_message",
  "error_transient",
  "input_tokens",
  "output_tokens",
  "usage_estimated",
  "audience",
];

function insertNamed(table: MemTable, cols: string[], params: unknown[]): void {
  const row: MemRow = {};
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c) row[c] = params[i] ?? null;
  }
  table.rows.push(row);
}

function updateBy(table: MemTable, cols: string[], params: unknown[]): void {
  const id = params[params.length - 1];
  const row = table.rows.find((r) => r.id === id);
  if (!row) return;
  for (let i = 0; i < cols.length - 1; i++) {
    const c = cols[i];
    if (c) row[c] = params[i] ?? null;
  }
}

// --- keychain / fs / lifecycle mocks --------------------------------
function memKeychain() {
  const store = new Map<string, string>();
  setKc({
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => {
      store.set(k, v);
    },
    remove: async (k) => {
      store.delete(k);
    },
    list: async () => [...store.keys()],
  });
}

function memFs() {
  const store = new Map<string, string>();
  setFs({
    readText: async (p) => store.get(p) ?? "",
    writeText: async (p, c) => {
      store.set(p, c);
    },
    appendText: async (p, c) => {
      store.set(p, (store.get(p) ?? "") + c);
    },
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    exists: async (p) => store.has(p),
    mkdir: async () => {},
    saveDialog: async () => "/tmp/export.html",
    openDialog: async () => null,
  });
}

function memLifecycle() {
  // Claim we're Tauri so App.tsx runs migrations against our mem SQL.
  setLc({ isTauri: () => true, onBeforeUnload: () => () => {} });
}

// Force every provider to use the mock adapter so E2E runs offline.
async function installMockAdapters(): Promise<void> {
  const reg = await import("../providers/registryOfAdapters");
  const { mockAdapter } = await import("../providers/mock");
  for (const k of Object.keys(reg.ADAPTERS)) {
    (reg.ADAPTERS as Record<string, unknown>)[k] = mockAdapter;
  }
}

export async function installBrowserMocks(): Promise<void> {
  memSql();
  memKeychain();
  memFs();
  memLifecycle();
  await installMockAdapters();
}
