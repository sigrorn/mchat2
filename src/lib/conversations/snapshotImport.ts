// ------------------------------------------------------------------
// Component: Snapshot import
// Responsibility: Restore a conversation from a snapshot file. Creates
//                 conversation, personas, and messages with full ID
//                 remapping from names back to fresh IDs.
// Collaborators: snapshot.ts, snapshotFileOps.ts, Sidebar.tsx.
// ------------------------------------------------------------------

import type { Conversation, Persona, ProviderId } from "../types";
import type { SnapshotEnvelope } from "./snapshot";
import { createPersona, updatePersona } from "../personas/service";
import { slugify } from "../personas/slug";
import * as convRepo from "../persistence/conversations";
import * as messagesRepo from "../persistence/messages";
import * as flowsRepo from "../persistence/flows";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { keychain } from "../tauri/keychain";
import { migrateRunsAfterToFlow } from "./migrateRunsAfterToFlow";
import { migrateApertusInConversation } from "./migrateApertusToOpenaiCompat";
import {
  loadOpenAICompatConfig,
  setBuiltinPresetConfig,
} from "../providers/openaiCompatStorage";

export interface ImportResult {
  conversation: Conversation;
  personas: Persona[];
  missingKeys: string[];
}

export async function importSnapshot(snapshot: SnapshotEnvelope): Promise<ImportResult> {
  // 1. Create conversation.
  const conv = await convRepo.createConversation({
    title: snapshot.title,
    systemPrompt: snapshot.systemPrompt ?? null,
    displayMode: (snapshot.displayMode === "cols" ? "cols" : "lines") as "lines" | "cols",
    visibilityMode:
      (snapshot.visibilityMode === "joined" ? "joined" : "separated") as "separated" | "joined",
    visibilityMatrix: {},
    selectedPersonas: [],
    compactionFloorIndex: snapshot.compactionFloorIndex ?? null,
    autocompactThreshold: null,
    contextWarningsFired: [],
    lastProvider: null,
  });

  // 2. Create personas (two-pass for runsAfter).
  const nameToId = new Map<string, string>();
  const created: Persona[] = [];
  // #258 Phase C: legacy snapshots may still carry apertusProductId
  // on apertus-provider personas. Capture the first non-null value
  // here so we can write it to the openai_compat infomaniak preset's
  // global PRODUCT_ID template var below — the column the value used
  // to live in is gone, so migrateApertusInConversation's read path
  // can't surface it post-Phase-C.
  let legacyApertusProductIdFromSnapshot: string | null = null;

  for (const sp of snapshot.personas) {
    if (sp.provider === ("apertus" as unknown as ProviderId)
        && sp.apertusProductId
        && legacyApertusProductIdFromSnapshot === null) {
      legacyApertusProductIdFromSnapshot = sp.apertusProductId;
    }
    const p = await createPersona({
      conversationId: conv.id,
      provider: sp.provider,
      name: sp.name,
      systemPromptOverride: sp.systemPromptOverride,
      modelOverride: sp.modelOverride,
      colorOverride: sp.colorOverride,
      visibilityDefaults: sp.visibilityDefaults ?? {},
      currentMessageIndex: sp.createdAtMessageIndex,
      sortOrder: sp.sortOrder,
    });
    nameToId.set(sp.name.toLowerCase(), p.id);
    nameToId.set(slugify(sp.name), p.id);
    created.push(p);
  }

  // Patch roleLens now that all IDs exist. (#241 Phase C dropped the
  // persistent runs_after column — legacy snapshot edges flow into a
  // transient map below for migrateRunsAfterToFlow rather than being
  // written to Persona rows.)
  const importedRunsAfter = new Map<string, readonly string[]>();
  for (let i = 0; i < snapshot.personas.length; i++) {
    const sp = snapshot.personas[i]!;
    const p = created[i]!;
    if (sp.runsAfter && sp.runsAfter.length > 0) {
      const parentIds = sp.runsAfter
        .map((name) => nameToId.get(name.toLowerCase()))
        .filter((id): id is string => id !== undefined);
      if (parentIds.length > 0) importedRunsAfter.set(p.id, parentIds);
    }
    if (sp.roleLens && Object.keys(sp.roleLens).length > 0) {
      // #213: lens entries are name-keyed on disk; remap to fresh ids.
      // The literal "user" passes through unchanged. Names that don't
      // resolve are dropped silently (the speaker simply isn't part of
      // the imported conversation any more).
      const remapped: Record<string, "user" | "assistant"> = {};
      for (const [key, value] of Object.entries(sp.roleLens)) {
        if (key === "user") {
          remapped.user = value;
        } else {
          const id = nameToId.get(key.toLowerCase());
          if (id) remapped[id] = value;
        }
      }
      if (Object.keys(remapped).length > 0) {
        await updatePersona({ id: p.id, roleLens: remapped });
      }
    }
  }

  // 3. Resolve visibility matrix (names → IDs).
  const resolvedMatrix: Record<string, string[]> = {};
  for (const [observerName, sourceNames] of Object.entries(snapshot.visibilityMatrix)) {
    const observerId = nameToId.get(observerName.toLowerCase());
    if (!observerId) continue;
    resolvedMatrix[observerId] = sourceNames
      .map((n) => nameToId.get(n.toLowerCase()))
      .filter((id): id is string => id !== undefined);
  }

  // 4. Resolve selection (names → IDs).
  const selectedIds = (snapshot.selectedPersonas ?? [])
    .map((n) => nameToId.get(n.toLowerCase()))
    .filter((id): id is string => id !== undefined);

  // Update conversation with resolved matrix and selection.
  const updatedConv: Conversation = {
    ...conv,
    visibilityMatrix: resolvedMatrix,
    selectedPersonas: selectedIds,
  };
  await convRepo.updateConversation(updatedConv);

  // 5. Import messages with name → ID remapping.
  const resolveId = (name: string | null): string | null => {
    if (name === null) return null;
    return nameToId.get(name.toLowerCase()) ?? null;
  };
  const resolveIds = (names: string[]): string[] =>
    names.map((n) => nameToId.get(n.toLowerCase())).filter((id): id is string => id !== undefined);

  for (const sm of snapshot.messages) {
    await messagesRepo.appendMessage({
      conversationId: conv.id,
      role: sm.role as "user" | "assistant" | "system" | "notice",
      content: sm.content,
      provider: (sm.provider as ProviderId) ?? null,
      model: sm.model ?? null,
      personaId: resolveId(sm.persona),
      displayMode: sm.displayMode === "cols" ? "cols" : "lines",
      pinned: sm.pinned,
      pinTarget: resolveId(sm.pinTarget),
      addressedTo: resolveIds(sm.addressedTo),
      errorMessage: sm.errorMessage ?? null,
      errorTransient: sm.errorTransient,
      inputTokens: sm.inputTokens,
      outputTokens: sm.outputTokens,
      usageEstimated: sm.usageEstimated,
      audience: resolveIds(sm.audience),
      // #231: defaults to false when absent (legacy snapshots).
      flowDispatched: sm.flowDispatched ?? false,
    });
  }

  // 5b. Recreate the flow if bundled. Persona names are remapped to
  // freshly-assigned ids; names that don't resolve are dropped.
  if (snapshot.flow) {
    const remappedSteps = snapshot.flow.steps.map((s) => ({
      kind: s.kind,
      personaIds: s.personas
        .map((n) => nameToId.get(n.toLowerCase()))
        .filter((id): id is string => id !== undefined),
      // #230: carry the per-step instruction across import. flowsRepo
      // normalises empty/whitespace to null on store.
      instruction: s.instruction ?? null,
    }));
    // Defensive: if a `personas` step lost all members in remap, drop
    // the step rather than trip the empty-personas validation.
    const cleaned = remappedSteps.filter(
      (s) => !(s.kind === "personas" && s.personaIds.length === 0),
    );
    if (cleaned.length > 0) {
      // #220: bound loopStartIndex to the cleaned step count. If a
      // remap dropped enough steps to push the saved value past the
      // new array bounds, fall back to 0 — better than tripping the
      // upsert's validation.
      const rawLoopStart = snapshot.flow.loopStartIndex ?? 0;
      const safeLoopStart =
        rawLoopStart >= 0 && rawLoopStart < cleaned.length ? rawLoopStart : 0;
      await flowsRepo.upsertFlow(conv.id, {
        currentStepIndex: snapshot.flow.currentStepIndex,
        loopStartIndex: safeLoopStart,
        steps: cleaned,
      });
    }
  }

  // 5c. #241 Phase 0 / Trigger B: legacy snapshots that carry
  // runs_after but no bundled flow auto-derive one at import time.
  // Skipped silently when the snapshot already had a flow attached
  // (handled in 5b above) — migrateRunsAfterToFlow respects the
  // existing flow and only emits the re-export notice.
  if (importedRunsAfter.size > 0) {
    await migrateRunsAfterToFlow(conv.id, importedRunsAfter, {
      trigger: "import",
    });
  }

  // 5d. #255 Phase 0 / #258 Phase C: legacy snapshots authored against
  // the native apertus adapter convert in-place to openai_compat
  // (Infomaniak preset). The migrator rewrites every persona row,
  // the messages' provider column, mirrors the api key, and appends a
  // notice. No-op for snapshots that already use openai_compat.
  // The captured productId is written to the global preset config
  // first so the migrator's idempotent "don't clobber existing"
  // check leaves it in place.
  if (legacyApertusProductIdFromSnapshot) {
    const cfg = await loadOpenAICompatConfig();
    const existing = cfg.builtins["infomaniak"]?.templateVars["PRODUCT_ID"];
    if (!existing) {
      await setBuiltinPresetConfig("infomaniak", {
        templateVars: { PRODUCT_ID: legacyApertusProductIdFromSnapshot },
        extraHeaders: cfg.builtins["infomaniak"]?.extraHeaders ?? {},
      });
    }
  }
  await migrateApertusInConversation(conv.id);

  // 6. Validate API keys. Re-list personas after the apertus migration
  // so the post-conversion provider drives which keychain slot we
  // check (apertus persona that just became openai_compat is now
  // gated by the openai_compat infomaniak slot, not apertus_api_key).
  const personasAfterMigration = await (await import("../persistence/personas")).listPersonas(
    conv.id,
  );
  const missingKeys: string[] = [];
  for (const p of personasAfterMigration) {
    const reg = PROVIDER_REGISTRY[p.provider];
    if (reg.requiresKey) {
      const key = await keychain.get(reg.keychainKey);
      if (!key) missingKeys.push(p.name);
    }
  }

  return { conversation: updatedConv, personas: personasAfterMigration, missingKeys };
}
