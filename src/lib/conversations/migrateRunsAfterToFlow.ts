// ------------------------------------------------------------------
// Component: Auto-migration legacy runs_after → conversation flow (#241)
// Responsibility: Phase 0 of the runs_after removal — and after Phase C
//                 also the only consumer of legacy runs_after data
//                 (which now lives transiently inside import payloads,
//                 not on disk). Given a map from persona-id to its
//                 declared parent-ids, derive a FlowDraft via the
//                 level-grouping derivation, persist it (only if no
//                 flow is already attached on the conversation), and
//                 append a trigger-specific notice explaining the
//                 conversion.
// Idempotence:    Existing flow on the conversation is respected —
//                 never overwritten — and the migration short-circuits
//                 silently when the supplied map is empty.
// Collaborators: lib/flows/derivation, lib/persistence/{personas,flows,
//                messages}.
// ------------------------------------------------------------------

import { derivedFlowFromRunsAfter } from "../flows/derivation";
import * as personasRepo from "../persistence/personas";
import * as flowsRepo from "../persistence/flows";
import * as messagesRepo from "../persistence/messages";

const NOTICE_OPEN =
  "Converted this conversation's persona ordering rules (runs_after) to a conversation flow. Open the flow editor from the personas panel to review or edit the steps.";

const NOTICE_IMPORT =
  "Imported personas carried legacy ordering rules (runs_after); converted to this conversation's flow. Re-export your persona setup to capture the new flow definition in the file.";

export interface MigrationResult {
  /** True iff a brand-new flow was persisted. False when one already
   *  existed (in which case it was left untouched) or no derivation
   *  was needed. */
  converted: boolean;
  /** True iff a notice was appended to the conversation. */
  noticeAppended: boolean;
}

const NO_OP: MigrationResult = { converted: false, noticeAppended: false };

export interface MigrateOptions {
  trigger: "open" | "import";
}

/**
 * Convert a transient runs_after edge map into a conversation flow.
 * `runsAfter` keys are persona-ids; values are parent persona-ids.
 * Empty / undefined entries mean "no parents" (root of the DAG).
 *
 * The map is the only data source — Phase C of #241 dropped the
 * persistent column, so callers (import paths) collect the edges
 * from their input and pass them in here.
 */
export async function migrateRunsAfterToFlow(
  conversationId: string,
  runsAfter: ReadonlyMap<string, readonly string[]>,
  opts: MigrateOptions,
): Promise<MigrationResult> {
  // Drop empty entries up-front — no edges = nothing to convert.
  const nonEmpty = new Map<string, readonly string[]>();
  for (const [id, parents] of runsAfter) {
    if (parents.length > 0) nonEmpty.set(id, parents);
  }
  if (nonEmpty.size === 0) return NO_OP;

  const existingFlow = await flowsRepo.getFlow(conversationId);
  let converted = false;
  if (!existingFlow) {
    const personas = await personasRepo.listPersonas(conversationId);
    const live = personas.filter((p) => p.deletedAt === null);
    const draft = derivedFlowFromRunsAfter(live, nonEmpty);
    if (draft.steps.length > 0) {
      await flowsRepo.upsertFlow(conversationId, draft);
      converted = true;
    }
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

  return { converted, noticeAppended: true };
}
