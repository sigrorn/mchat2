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
import * as flowsRepo from "../persistence/flows";
import { invalidateRepoQuery } from "../data/useRepoQuery";
import { transaction } from "../persistence/transaction";
import { ensureIdentityPin } from "./identityPin";
import { slugify } from "./slug";
import { migrateRunsAfterToFlow } from "../conversations/migrateRunsAfterToFlow";
import type { Flow, Persona } from "../types";

function prefixWorkingDir(filename: string, workingDir: string | null): string {
  return workingDir ? `${workingDir}/${filename}` : filename;
}

export type ExportOutcome = { ok: true; path: string } | { ok: false; reason: "cancelled" };

export async function exportPersonasToFile(
  conversationTitle: string,
  personas: readonly Persona[],
  workingDir: string | null,
  // #236: optional flow to bundle. When omitted, the export envelope
  // has no `flow` field — preserves byte-identity with pre-#236 exports.
  flow?: Flow | null,
): Promise<ExportOutcome> {
  const json = serializePersonas(personas, flow ? { flow } : undefined);
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
  const resolved = resolveImport(existing, parsed.personas, parsed.flow);
  // #164: an N-persona import is the most write-heavy multi-step
  // mutation we have — N creates, M runsAfter patches, K identity pins.
  // A mid-import failure used to leave half-created personas with no
  // pins and dangling runsAfter references; wrapping the whole sequence
  // in a transaction makes the import either fully apply or not at all.
  const { created, skipped, visibilityWarnings } = await transaction(async () => {
    const created: Persona[] = [];
    // Two-pass for runsAfter: first create everything without parent
    // links, then patch them in once all ids exist.
    // #258 Phase C: legacy entry.apertusProductId is no longer a
    // createPersona input. Captured here for the post-create
    // migrator to write to the openai_compat infomaniak preset.
    let legacyApertusProductId: string | null = null;
    for (const entry of resolved.toCreate) {
      if (entry.apertusProductId && legacyApertusProductId === null) {
        legacyApertusProductId = entry.apertusProductId;
      }
      const p = await createPersona({
        conversationId,
        provider: entry.provider,
        name: entry.name,
        systemPromptOverride: entry.systemPromptOverride,
        modelOverride: entry.modelOverride,
        colorOverride: entry.colorOverride,
        visibilityDefaults: entry.visibilityDefaults,
        currentMessageIndex,
      });
      created.push(p);
    }
    void legacyApertusProductId; // surfaced via the on-conversation migrator path
    // Build a name-slug → id map across existing live + freshly created.
    // #241 Phase C dropped runs_after on disk; legacy edges from the
    // imported file flow into a transient map below for the
    // migrateRunsAfterToFlow call rather than being persisted on
    // Persona rows.
    const post = await repo.listPersonas(conversationId);
    const live = post.filter((p) => p.deletedAt === null);
    const idBySlug = new Map(live.map((p) => [p.nameSlug, p.id] as const));
    const importedRunsAfter = new Map<string, readonly string[]>();
    for (const entry of resolved.toCreate) {
      if (!entry.runsAfter || entry.runsAfter.length === 0) continue;
      const parentIds = entry.runsAfter
        .map((name) => idBySlug.get(slugify(name)))
        .filter((id): id is string => id !== undefined);
      if (parentIds.length === 0) continue;
      const child = post.find((x) => x.nameSlug === slugify(entry.name));
      if (!child) continue;
      importedRunsAfter.set(child.id, parentIds);
    }
    // #236: apply per-persona roleLens. The on-disk lens is name-keyed;
    // remap to ids against the post-import set. The literal "user" key
    // passes through unchanged. Names that don't resolve (e.g. a lens
    // entry referencing a persona that wasn't in the import file) are
    // dropped silently — same policy as snapshotImport's #213 path.
    for (const entry of resolved.toCreate) {
      if (!entry.roleLens) continue;
      const remapped: Record<string, "user" | "assistant"> = {};
      for (const [key, value] of Object.entries(entry.roleLens)) {
        if (key === "user") {
          remapped.user = value;
        } else {
          const id = idBySlug.get(slugify(key));
          if (id) remapped[id] = value;
        }
      }
      if (Object.keys(remapped).length === 0) continue;
      const p = post.find((x) => x.nameSlug === slugify(entry.name));
      if (!p) continue;
      await updatePersona({ id: p.id, roleLens: remapped });
    }
    // #236: recreate the bundled flow against the freshly-assigned
    // ids. Names that don't resolve are dropped; if a personas-step
    // loses every member it's dropped rather than tripping the empty-
    // personas validation. Mirrors the snapshot import's #215 path.
    if (resolved.flow) {
      const remappedSteps = resolved.flow.steps.map((s) => ({
        kind: s.kind,
        personaIds: s.personas
          .map((name) => idBySlug.get(slugify(name)))
          .filter((id): id is string => id !== undefined),
        instruction: s.instruction ?? null,
      }));
      const cleaned = remappedSteps.filter(
        (s) => !(s.kind === "personas" && s.personaIds.length === 0),
      );
      if (cleaned.length > 0) {
        const rawLoopStart = resolved.flow.loopStartIndex ?? 0;
        const safeLoopStart =
          rawLoopStart >= 0 && rawLoopStart < cleaned.length ? rawLoopStart : 0;
        await flowsRepo.upsertFlow(conversationId, {
          currentStepIndex: resolved.flow.currentStepIndex,
          loopStartIndex: safeLoopStart,
          steps: cleaned,
        });
        // #236 follow-up: bump the flow query cache so PersonaPanel
        // re-reads the freshly-imported flow and renders the
        // "Conversation flow" row immediately instead of waiting for
        // the next @convo / FlowEditor save to invalidate it.
        invalidateRepoQuery(["flow"]);
      }
    }
    // #241 Phase 0 / Trigger B: legacy runs_after edges from the
    // imported file fold into a conversation flow + re-export notice.
    // Existing flow on the conversation wins (the migration won't
    // overwrite it); the notice still fires so the user knows their
    // archived persona file is out of date.
    if (importedRunsAfter.size > 0) {
      const migration = await migrateRunsAfterToFlow(
        conversationId,
        importedRunsAfter,
        { trigger: "import" },
      );
      if (migration.converted) invalidateRepoQuery(["flow"]);
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
