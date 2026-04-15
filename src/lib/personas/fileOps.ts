// ------------------------------------------------------------------
// Component: Persona file-ops orchestrator
// Responsibility: Glue between the import/export pure helpers, the fs
//                 plugin (dialogs + read/write), and the persona service
//                 so the UI just calls one function per direction.
// Collaborators: personas/importExport, personas/service, tauri/fs.
// ------------------------------------------------------------------

import { fs } from "../tauri/filesystem";
import {
  serializePersonas,
  parsePersonasImport,
  resolveImport,
} from "./importExport";
import { createPersona, updatePersona } from "./service";
import * as repo from "../persistence/personas";
import { slugify } from "./slug";
import type { Persona } from "../types";

export type ExportOutcome =
  | { ok: true; path: string }
  | { ok: false; reason: "cancelled" };

export async function exportPersonasToFile(
  conversationTitle: string,
  personas: readonly Persona[],
): Promise<ExportOutcome> {
  const json = serializePersonas(personas);
  const defaultPath = defaultExportFilename(conversationTitle);
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
  const chosen = await fs.openDialog({
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
    if (!entry.runsAfter) continue;
    const targetId = idBySlug.get(slugify(entry.runsAfter));
    if (!targetId) continue;
    const persona = post.find((p) => p.nameSlug === slugify(entry.name));
    if (!persona) continue;
    await updatePersona({ id: persona.id, runsAfter: targetId });
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
