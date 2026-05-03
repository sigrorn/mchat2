// ------------------------------------------------------------------
// Component: Compaction runner
// Responsibility: Shared implementation of both manual //compact and
//                 auto-triggered compaction. Handles the preserve-N
//                 flow: compute cutoff, run per-persona summarization
//                 in parallel, physically insert summaries at cutoff
//                 via index shift, update compactionFloor + limit,
//                 produce per-persona stats.
// Collaborators: components/Composer.tsx (//compact),
//                hooks/postResponseCheck.ts (autocompact).
// ------------------------------------------------------------------

import type { Conversation, Persona, PersonaTarget } from "../types";
import { buildContext } from "../context";
import { estimateTokens } from "../context/truncate";
import { generateCompactionSummary } from "./compact";
import { adapterFor } from "../providers/registryOfAdapters";
import { PROVIDER_REGISTRY } from "../providers/registry";
import { maxContextTokensForPersona } from "../providers/contextWindows";
import { modelForTarget } from "../orchestration/streamRunner";
import { resolveExtraConfig } from "../providers/extraConfig";
import { keychain } from "../tauri/keychain";
import { getSetting } from "../persistence/settings";
import { GLOBAL_SYSTEM_PROMPT_KEY } from "../settings/keys";
import { idleTimeoutMs as idleTimeoutSetting } from "../settings/registry";
import * as messagesRepo from "../persistence/messages";
import { computeCompactionCutoff } from "./compactionCutoff";

export interface PersonaCompactionStat {
  persona: Persona;
  origTokens: number;
  summaryTokens: number;
  preservedTokens: number;
  elapsedMs: number;
}

export interface CompactionFailure {
  persona: Persona;
  error: string;
}

export interface RunCompactionResult {
  ok: boolean;
  summaries: PersonaCompactionStat[];
  failures: CompactionFailure[];
  cutoff: number;
  tightestMaxTokens: number;
  // True if nothing was compacted (e.g., preserve count is too high,
  // leaving nothing to summarize).
  nothingToDo: boolean;
}

export interface RunCompactionHooks {
  // Called with conversation id and persona id when that persona's
  // compaction starts streaming. Used for UI status (yellow).
  onPersonaStart?: (personaId: string) => void;
  // Called when that persona fails. Used for UI status (red).
  onPersonaError?: (personaId: string) => void;
  // Called when that persona finishes (success or failure). Clears status.
  onPersonaDone?: (personaId: string) => void;
  // Called once when compaction is long enough that a "please wait"
  // notice is warranted. Currently fired when the pre-cutoff context
  // exceeds ~20k tokens.
  onSlow?: () => void;
}

/**
 * Run a full compaction pass with optional preservation of the last N
 * user messages per persona. Mutates the DB (shifts indices, inserts
 * COMPACTION notice + summaries, updates conversation floor + limit)
 * and returns per-persona stats for reporting.
 */
export async function runCompaction(
  conversation: Conversation,
  personas: readonly Persona[],
  preserveN: number,
  hooks: RunCompactionHooks = {},
): Promise<RunCompactionResult> {
  const tightestMaxTokens =
    personas.length === 0 ? Infinity : Math.min(...personas.map(maxContextTokensForPersona));

  // Reload fresh history so we see any messages appended since the
  // caller captured state.
  const history = await messagesRepo.listMessages(conversation.id);
  const floor = conversation.compactionFloorIndex ?? 0;

  const cutoff = computeCompactionCutoff(conversation, history, personas, preserveN);
  if (cutoff <= floor) {
    return {
      ok: true,
      summaries: [],
      failures: [],
      cutoff,
      tightestMaxTokens,
      nothingToDo: true,
    };
  }

  // Messages to be compacted (strictly below cutoff).
  const preHistory = history.filter((m) => m.index < cutoff);
  const preservedMessages = history.filter((m) => m.index >= cutoff);

  const globalPrompt = await getSetting(GLOBAL_SYSTEM_PROMPT_KEY);
  const idleTimeoutMs = await idleTimeoutSetting.get();

  // Build per-persona context for summarization (only pre-cutoff part).
  // Also compute preserved-token totals per persona (so the report can
  // show summary% + preserved%).
  const preCutoffContextByPersona = new Map<
    string,
    { origTokens: number; messages: readonly import("../providers/adapter").ChatMessage[] }
  >();
  let totalPreCutoffTokens = 0;
  for (const p of personas) {
    const target: PersonaTarget = {
      provider: p.provider,
      personaId: p.id,
      key: p.id,
      displayName: p.name,
    };
    const ctx = buildContext({
      conversation,
      target,
      messages: preHistory,
      personas: [...personas],
      globalSystemPrompt: globalPrompt,
    });
    const origTokens =
      (ctx.systemPrompt ? estimateTokens(ctx.systemPrompt) : 0) +
      ctx.messages.reduce((s, m) => s + estimateTokens(m.content), 0);
    preCutoffContextByPersona.set(p.id, { origTokens, messages: ctx.messages });
    totalPreCutoffTokens = Math.max(totalPreCutoffTokens, origTokens);
  }

  if (totalPreCutoffTokens > 20000) hooks.onSlow?.();

  type Result =
    | {
        ok: true;
        persona: Persona;
        summary: string;
        origTokens: number;
        summaryTokens: number;
        preservedTokens: number;
        elapsedMs: number;
        /** #122 — per-summary streaming timings, persisted on the inserted row. */
        ttftMs: number | null;
        streamMs: number | null;
        /** #122 — tokens reported by the model, used to persist output_tokens on the row. */
        reportedOutputTokens: number;
      }
    | { ok: false; persona: Persona; error: string };

  const results = await Promise.all(
    personas.map(async (p): Promise<Result | null> => {
      const ctxInfo = preCutoffContextByPersona.get(p.id);
      if (!ctxInfo || ctxInfo.messages.length === 0) return null;
      hooks.onPersonaStart?.(p.id);
      const t0 = Date.now();
      try {
        const target: PersonaTarget = {
          provider: p.provider,
          personaId: p.id,
          key: p.id,
          displayName: p.name,
        };
        const ak = PROVIDER_REGISTRY[p.provider].requiresKey
          ? await keychain.get(PROVIDER_REGISTRY[p.provider].keychainKey)
          : null;
        const model = modelForTarget(target, [...personas]);
        const extra = await resolveExtraConfig(p.provider, p);
        const summaryResult = await generateCompactionSummary(
          adapterFor(p.provider),
          ak,
          model,
          [...ctxInfo.messages],
          extra,
          idleTimeoutMs,
        );
        const elapsedMs = Date.now() - t0;
        if (!summaryResult.summary) {
          hooks.onPersonaError?.(p.id);
          return { ok: false, persona: p, error: "model returned empty summary" };
        }
        const summaryTokens = estimateTokens(summaryResult.summary);
        // Compute preserved tokens for this persona: rebuild context on
        // the preserved slice and sum.
        const preservedCtx = buildContext({
          conversation,
          target,
          messages: preservedMessages,
          personas: [...personas],
          globalSystemPrompt: globalPrompt,
        });
        const preservedTokens = preservedCtx.messages.reduce(
          (s, m) => s + estimateTokens(m.content),
          0,
        );
        return {
          ok: true,
          persona: p,
          summary: summaryResult.summary,
          origTokens: ctxInfo.origTokens,
          summaryTokens,
          preservedTokens,
          elapsedMs,
          ttftMs: summaryResult.ttftMs,
          streamMs: summaryResult.streamMs,
          reportedOutputTokens: summaryResult.outputTokens,
        };
      } catch (e) {
        hooks.onPersonaError?.(p.id);
        return { ok: false, persona: p, error: (e as Error).message };
      } finally {
        hooks.onPersonaDone?.(p.id);
      }
    }),
  );

  const successes: PersonaCompactionStat[] = [];
  const failures: CompactionFailure[] = [];
  const summaryContents: Array<{
    persona: Persona;
    summary: string;
    ttftMs: number | null;
    streamMs: number | null;
    reportedOutputTokens: number;
  }> = [];
  for (const r of results) {
    if (!r) continue;
    if (r.ok) {
      successes.push({
        persona: r.persona,
        origTokens: r.origTokens,
        summaryTokens: r.summaryTokens,
        preservedTokens: r.preservedTokens,
        elapsedMs: r.elapsedMs,
      });
      summaryContents.push({
        persona: r.persona,
        summary: r.summary,
        ttftMs: r.ttftMs,
        streamMs: r.streamMs,
        reportedOutputTokens: r.reportedOutputTokens,
      });
    } else {
      failures.push({ persona: r.persona, error: r.error });
    }
  }

  if (summaryContents.length === 0) {
    return {
      ok: false,
      summaries: [],
      failures,
      cutoff,
      tightestMaxTokens,
      nothingToDo: false,
    };
  }

  // Shift all messages >= cutoff up by (1 + numSummaries) to open a
  // gap, then insert the COMPACTION notice + summaries at cutoff.
  const shiftBy = 1 + summaryContents.length;
  await messagesRepo.shiftMessageIndicesFrom(conversation.id, cutoff, shiftBy);

  // Insert COMPACTION notice at `cutoff`.
  await messagesRepo.insertMessageAtIndex({
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

  // Insert per-persona summaries at cutoff+1 .. cutoff+numSummaries.
  // #122 — timings from the summary stream are persisted so the next
  // //stats run will include the compaction itself in the averages.
  for (let i = 0; i < summaryContents.length; i++) {
    const s = summaryContents[i]!;
    await messagesRepo.insertMessageAtIndex({
      conversationId: conversation.id,
      role: "assistant",
      content: `[compacted summary]\n\n${s.summary}`,
      provider: s.persona.provider,
      model: s.persona.modelOverride ?? PROVIDER_REGISTRY[s.persona.provider].defaultModel,
      personaId: s.persona.id,
      displayMode: "lines",
      pinned: true,
      pinTarget: s.persona.id,
      addressedTo: [],
      errorMessage: null,
      errorTransient: false,
      inputTokens: 0,
      outputTokens: s.reportedOutputTokens,
      usageEstimated: false,
      audience: [],
      ttftMs: s.ttftMs,
      streamMs: s.streamMs,
      index: cutoff + 1 + i,
    });
  }

  return {
    ok: true,
    summaries: successes,
    failures,
    cutoff,
    tightestMaxTokens,
    nothingToDo: false,
  };
}

/**
 * Format one persona's line for the post-compaction notice.
 */
export function formatPersonaLine(
  s: PersonaCompactionStat,
  tightestMaxTokens: number,
): string {
  const origK = (s.origTokens / 1000).toFixed(1);
  const compK = (s.summaryTokens / 1000).toFixed(1);
  const savingsPct = s.origTokens > 0 ? Math.round((1 - s.summaryTokens / s.origTokens) * 100) : 0;
  const sec = s.elapsedMs / 1000;
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(Math.floor(sec % 60)).padStart(2, "0");
  const fmtPct = (t: number): string =>
    Number.isFinite(tightestMaxTokens) && tightestMaxTokens > 0
      ? `${((t / tightestMaxTokens) * 100).toFixed(1)}%`
      : "—";
  const summaryPct = fmtPct(s.summaryTokens);
  const preservedPct = fmtPct(s.preservedTokens);
  const totalPct = fmtPct(s.summaryTokens + s.preservedTokens);
  return `  ${s.persona.name}  ${origK}k → ${compK}k  −${savingsPct}%  ${mm}:${ss}  (summary ${summaryPct} + preserved ${preservedPct} = ${totalPct} of tightest window)`;
}
