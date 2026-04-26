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
import { transaction } from "../persistence/transaction";
import { ensureIdentityPin } from "./identityPin";
import { slugify } from "./slug";
import type { Persona } from "../types";

function prefixWorkingDir(filename: string, workingDir: string | null): string {
  return workingDir ? `${workingDir}/${filename}` : filename;
}

export type ExportOutcome = { ok: true; path: string } | { ok: false; reason: "cancelled" };

export async function exportPersonasToFile(
  conversationTitle: string,
  personas: readonly Persona[],
  workingDir: string | null,
): Promise<ExportOutcome> {
  const json = serializePersonas(personas);
  const defaultPath = prefixWorkingDir(defaultExportFilename(conversationTitle), workingDir);
  const chosen = await fs.saveDialog({
    defaultPath,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  await fs.writeText(chosen, json);
  return { ok: true, path: chosen };
}

export type ImportOutcome =
  | { ok: true; created: Persona[]; skipped: string[]; visibilityWarnings: string[] }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "error"; message: string };

export async function importPersonasFromFile(
  conversationId: string,
  currentMessageIndex: number,
  workingDir: string | null,
): Promise<ImportOutcome> {
  const chosen = await fs.openDialog({
    ...(workingDir ? { defaultPath: workingDir } : {}),
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!chosen) return { ok: false, reason: "cancelled" };
  const raw = await fs.readText(chosen);
  const parsed = parsePersonasImport(raw);
  if (!parsed.ok) return { ok: false, reason: "error", message: parsed.error };
  const existing = await repo.listPersonas(conversationId);
  const resolved = resolveImport(existing, parsed.personas);
  // #164: an N-persona import is the most write-heavy multi-step
  // mutation we have — N creates, M runsAfter patches, K identity pins.
  // A mid-import failure used to leave half-created personas with no
  // pins and dangling runsAfter references; wrapping the whole sequence
  // in a transaction makes the import either fully apply or not at all.
  const { created, skipped, visibilityWarnings } = await transaction(async () => {
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
        visibilityDefaults: entry.visibilityDefaults,
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
    return {
      created,
      skipped: resolved.skipped,
      visibilityWarnings: resolved.visibilityWarnings,
    };
  });
  return { ok: true, created, skipped, visibilityWarnings };
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
