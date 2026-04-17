// ------------------------------------------------------------------
// Component: Persona file-ops orchestrator
// Responsibility: Glue between the import/export pure helpers, the fs
//                 plugin (dialogs + read/write), and the persona service
//                 so the UI just calls one function per direction.
// Collaborators: personas/importExport, personas/service, tauri/fs.
// ------------------------------------------------------------------

import { fs } from "../tauri/filesystem";
import { serializePersonas, parsePersonasImport, resolveImport } from "./importExport";
import { createPersona, updatePersona } from "./service";
import * as repo from "../persistence/personas";
import * as messagesRepo from "../persistence/messages";
import { ensureIdentityPin } from "./identityPin";
import { slugify } from "./slug";
import { useUiStore } from "../../stores/uiStore";
import type { Persona } from "../types";

function prefixWorkingDir(filename: string): string {
  const dir = useUiStore.getState().workingDir;
  return dir ? `${dir}/${filename}` : filename;
}

export type ExportOutcome = { ok: true; path: string } | { ok: false; reason: "cancelled" };

export async function exportPersonasToFile(
  conversationTitle: string,
  personas: readonly Persona[],
): Promise<ExportOutcome> {
  const json = serializePersonas(personas);
  const defaultPath = prefixWorkingDir(defaultExportFilename(conversationTitle));
  const chosen = await fs.saveDialog({
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  await fs.writeText(chosen, json);
  return { ok: true, path: chosen };
}

export type ImportOutcome =
  | { ok: true; created: Persona[]; skipped: string[] }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "error"; message: string };

export async function importPersonasFromFile(
  conversationId: string,
  currentMessageIndex: number,
): Promise<ImportOutcome> {
  const dir = useUiStore.getState().workingDir;
  const chosen = await fs.openDialog({
    ...(dir ? { defaultPath: dir } : {}),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  const raw = await fs.readText(chosen);
  const parsed = parsePersonasImport(raw);
  if (!parsed.ok) return { ok: false, reason: "error", message: parsed.error };
  const existing = await repo.listPersonas(conversationId);
  const resolved = resolveImport(existing, parsed.personas);
  const created: Persona[] = [];
  // Two-pass for runsAfter: first create everything without parent
  // links, then patch them in once all ids exist.
  for (const entry of resolved.toCreate) {
    const p = await createPersona({
      conversationId,
      provider: entry.provider,
      name: entry.name,
      systemPromptOverride: entry.systemPromptOverride,
      modelOverride: entry.modelOverride,
      colorOverride: entry.colorOverride,
      apertusProductId: entry.apertusProductId,
      currentMessageIndex,
    });
    created.push(p);
  }
  // Build a name-slug → id map across existing live + freshly created.
  const post = await repo.listPersonas(conversationId);
  const idBySlug = new Map(
    post.filter((p) => p.deletedAt === null).map((p) => [p.nameSlug, p.id] as const),
  );
  for (const entry of resolved.toCreate) {
    if (entry.runsAfter.length === 0) continue;
    const parentIds = entry.runsAfter
      .map((name) => idBySlug.get(slugify(name)))
      .filter((id): id is string => id !== undefined);
    if (parentIds.length === 0) continue;
    const p = post.find((x) => x.nameSlug === slugify(entry.name));
    if (!p) continue;
    await updatePersona({ id: p.id, runsAfter: parentIds });
  }
  // #36: every imported persona needs the same identity pin that
  // CreateForm sets up — without it the LLM defaults to its provider
  // identity ("My name is Claude") rather than the imported name.
  const history = await messagesRepo.listMessages(conversationId);
  for (const p of created) {
    await ensureIdentityPin(conversationId, p, history, messagesRepo);
  }
  return { ok: true, created, skipped: resolved.skipped };
}

export function defaultExportFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  const base = slug || "chat";
  return `${base}-personas.json`;
}
