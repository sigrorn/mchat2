// ------------------------------------------------------------------
// Component: Auto-migration runs_after → conversation flow (#241)
// Responsibility: Phase 0 of the runs_after removal. When a conversation
//                 is opened (Trigger A) or personas are imported into it
//                 (Trigger B) and any active persona still carries
//                 runs_after edges, derive a flow via
//                 derivedFlowFromRunsAfter, persist it (only if no flow
//                 is already attached), clear runsAfter on the affected
//                 personas, and append a trigger-specific notice
//                 explaining the conversion.
// Idempotence:    A second invocation finds runsAfter already cleared
//                 and returns a no-op result. The presence of an
//                 existing flow is independently respected — never
//                 overwritten — but runsAfter is still cleared in that
//                 case to avoid drift between the two surfaces.
// Collaborators: lib/flows/derivation, lib/persistence/{personas,flows,
//                messages}, lib/personas/service (updatePersona).
// ------------------------------------------------------------------

import { derivedFlowFromRunsAfter } from "../flows/derivation";
import * as personasRepo from "../persistence/personas";
import * as flowsRepo from "../persistence/flows";
import * as messagesRepo from "../persistence/messages";
import { updatePersona } from "../personas/service";

const NOTICE_OPEN =
  "Converted this conversation's persona ordering rules (runs_after) to a conversation flow. Open the flow editor from the personas panel to review or edit the steps.";

const NOTICE_IMPORT =
  "Imported personas carried legacy ordering rules (runs_after); converted to this conversation's flow. Re-export your persona setup to capture the new flow definition in the file.";

export interface MigrationResult {
  /** True iff a brand-new flow was persisted. False when one already
   *  existed (in which case it was left untouched) or no derivation
   *  was needed. */
  converted: boolean;
  /** True iff at least one persona had its runsAfter cleared. */
  cleared: boolean;
  /** True iff a notice was appended to the conversation. */
  noticeAppended: boolean;
}

const NO_OP: MigrationResult = {
  converted: false,
  cleared: false,
  noticeAppended: false,
};

export interface MigrateOptions {
  trigger: "open" | "import";
}

export async function migrateRunsAfterToFlow(
  conversationId: string,
  opts: MigrateOptions,
): Promise<MigrationResult> {
  const personas = await personasRepo.listPersonas(conversationId);
  const live = personas.filter((p) => p.deletedAt === null);
  const withRunsAfter = live.filter((p) => p.runsAfter.length > 0);
  if (withRunsAfter.length === 0) return NO_OP;

  const existingFlow = await flowsRepo.getFlow(conversationId);

  let converted = false;
  if (!existingFlow) {
    const draft = derivedFlowFromRunsAfter(live);
    if (draft.steps.length > 0) {
      await flowsRepo.upsertFlow(conversationId, draft);
      converted = true;
    }
  }

  // Clear runsAfter on every affected persona — whether or not we
  // persisted a flow — so the legacy state does not silently drift
  // alongside the flow representation. updatePersona({runsAfter: []})
  // skips the cycle/parent validation when the array is empty.
  for (const p of withRunsAfter) {
    await updatePersona({ id: p.id, runsAfter: [] });
  }

  const content = opts.trigger === "open" ? NOTICE_OPEN : NOTICE_IMPORT;
  await messagesRepo.appendMessage({
    conversationId,
    role: "notice",
    content,
    provider: null,
    model: null,
    personaId: null,
    displayMode: "lines",
    pinned: false,
    pinTarget: null,
    addressedTo: [],
    errorMessage: null,
    errorTransient: false,
    inputTokens: 0,
    outputTokens: 0,
    usageEstimated: false,
    audience: [],
  });

  return { converted, cleared: true, noticeAppended: true };
}
