// ------------------------------------------------------------------
// Component: HTML-export orchestrator (issue #17)
// Responsibility: Glue between repos, keychain, fs, and the
//                 rendering/htmlExport library so the UI just calls
//                 one function. Pure-ish — its dependencies are the
//                 mockable lib/tauri modules and the redaction helper.
// Collaborators: rendering/htmlExport, tauri/fs, tauri/keychain.
// ------------------------------------------------------------------

import { exportToHtml } from "../rendering/htmlExport";
import { exportToMarkdown } from "../rendering/markdownExport";
import { fs } from "../tauri/filesystem";
import { keychain } from "../tauri/keychain";
import { slugify } from "../personas/slug";
import type { Conversation, Message, Persona } from "../types";

export interface ExportInput {
  conversation: Conversation;
  messages: readonly Message[];
  personas: readonly Persona[];
  // ISO timestamp; injected so unit tests are deterministic.
  generatedAt: string;
}

export type ExportResult = { ok: true; path: string } | { ok: false; reason: "cancelled" };

export async function exportConversationToHtml(input: ExportInput): Promise<ExportResult> {
  const knownSecrets = await collectKnownSecrets();
  const html = exportToHtml({
    conversation: input.conversation,
    messages: [...input.messages],
    personas: [...input.personas],
    knownSecrets,
    generatedAt: input.generatedAt,
  });
  const defaultPath = defaultExportFilename(input.conversation.title, input.generatedAt);
  const chosen = await fs.saveDialog({
    defaultPath,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  await fs.writeText(chosen, html);
  return { ok: true, path: chosen };
}

export async function exportConversationToMarkdown(input: ExportInput): Promise<ExportResult> {
  const knownSecrets = await collectKnownSecrets();
  const md = exportToMarkdown({
    conversation: input.conversation,
    messages: [...input.messages],
    personas: [...input.personas],
    knownSecrets,
  });
  const defaultPath = defaultExportFilename(input.conversation.title, input.generatedAt).replace(
    /\.html$/,
    ".md",
  );
  const chosen = await fs.saveDialog({
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  await fs.writeText(chosen, md);
  return { ok: true, path: chosen };
}

async function collectKnownSecrets(): Promise<string[]> {
  const out: string[] = [];
  const keys = await keychain.list();
  for (const k of keys) {
    const v = await keychain.get(k);
    if (v) out.push(v);
  }
  return out;
}

// Filesystem-safe filename derived from a conversation title + ISO
// timestamp. Colons and timezone separators get stripped so the name
// is portable across Windows / macOS / Linux.
export function defaultExportFilename(title: string, generatedAt: string): string {
  const slug =
    slugify(title) ||
    // slugify drops punctuation already; re-introduce dashes between
    // word runs by splitting the original on non-alnum. The slugify
    // helper produces 'mychat' from 'My Chat'; we want 'my-chat'.
    "";
  const dashed = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const base = dashed || slug || "chat";
  const stamp = generatedAt
    .replace(/[:.]/g, "-")
    .replace(/-\d+Z?$/, "")
    .replace(/-?Z$/, "");
  return `${base}-${stamp}.html`;
}
