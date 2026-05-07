// ------------------------------------------------------------------
// Component: Compaction commit phase
// Responsibility: Atomic DB phase of a compaction run — opens the
//                 numbered gap (shiftMessageIndicesFrom), inserts the
//                 COMPACTION notice + per-persona summaries, and moves
//                 the compactionFloor. Wrapped in transaction() so a
//                 mid-loop failure rolls back EVERY write — pre-call
//                 state is preserved.
// Collaborators: lib/conversations/runCompaction.ts (caller),
//                lib/persistence/{messages,conversations}.ts.
// History:       Extracted from runCompaction's tail in #268 to close
//                the multi-step-write hole noted in Codex's 2026-05-07
//                review. ADR 011's section-token transactions provide
//                the threading mechanism.
// ------------------------------------------------------------------

import type { Conversation, Persona } from "../types";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { transaction } from "../persistence/transaction";
import { reposFor } from "../persistence/repoContext";

export interface CompactionSummaryEntry {
  /** Source persona — used for personaId, provider, model on the
   * inserted summary row. */
  readonly persona?: Persona;
  /** Pre-resolved fields (allows tests to skip building a Persona). */
  readonly personaId?: string;
  readonly provider?: Persona["provider"];
  readonly model?: string;
  /** Summary body to insert. */
  readonly summary: string;
  /** #122 — streaming timings persisted on the inserted row. */
  readonly ttftMs: number | null;
  readonly streamMs: number | null;
  /** Reported output tokens; persisted on the inserted row. */
  readonly reportedOutputTokens: number;
}

function resolveProvider(entry: CompactionSummaryEntry): Persona["provider"] {
  if (entry.provider) return entry.provider;
  if (entry.persona) return entry.persona.provider;
  throw new Error("commitCompactionWrites: entry missing provider/persona");
}

function resolveModel(entry: CompactionSummaryEntry): string {
  if (entry.model) return entry.model;
  if (entry.persona) {
    return entry.persona.modelOverride ?? PROVIDER_REGISTRY[entry.persona.provider].defaultModel;
  }
  throw new Error("commitCompactionWrites: entry missing model/persona");
}

function resolvePersonaId(entry: CompactionSummaryEntry): string {
  if (entry.personaId) return entry.personaId;
  if (entry.persona) return entry.persona.id;
  throw new Error("commitCompactionWrites: entry missing personaId/persona");
}

/**
 * Atomic DB-phase commit of a compaction run. All writes occur in
 * one transaction:
 *
 *   1. shift idx >= cutoff up by (1 + N) to open a gap;
 *   2. insert the COMPACTION notice at cutoff;
 *   3. insert per-persona summaries at cutoff+1..cutoff+N;
 *   4. move the conversation's compactionFloorIndex to cutoff.
 *
 * Any throw mid-transaction triggers ROLLBACK — the conversation
 * looks identical to its pre-call state.
 */
export async function commitCompactionWrites(
  conversation: Conversation,
  cutoff: number,
  entries: readonly CompactionSummaryEntry[],
): Promise<void> {
  const shiftBy = 1 + entries.length;
  await transaction(async (txn) => {
    const repos = reposFor(txn.db);
    await repos.messages.shiftMessageIndicesFrom(conversation.id, cutoff, shiftBy);

    await repos.messages.insertMessageAtIndex({
      conversationId: conversation.id,
      role: "notice",
      content: "COMPACTION",
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
      index: cutoff,
    });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const personaId = resolvePersonaId(entry);
      await repos.messages.insertMessageAtIndex({
        conversationId: conversation.id,
        role: "assistant",
        content: `[compacted summary]\n\n${entry.summary}`,
        provider: resolveProvider(entry),
        model: resolveModel(entry),
        personaId,
        displayMode: "lines",
        pinned: true,
        pinTarget: personaId,
        addressedTo: [],
        errorMessage: null,
        errorTransient: false,
        inputTokens: 0,
        outputTokens: entry.reportedOutputTokens,
        usageEstimated: false,
        audience: [],
        ttftMs: entry.ttftMs,
        streamMs: entry.streamMs,
        index: cutoff + 1 + i,
      });
    }

    // #275: narrow setter — single UPDATE on compaction_floor_index.
    // The full updateConversation rewrites every column AND DELETE+
    // INSERTs the conversation_personas_selected, conversation_context_
    // warnings, and persona_visibility junction tables. We only want to
    // move one integer column.
    await repos.conversations.setCompactionFloor(conversation.id, cutoff);
  });
}
