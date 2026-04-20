// ------------------------------------------------------------------
// Component: Autocompact post-response check
// Responsibility: After each response round, check whether context
//                 exceeds the autocompact threshold or, if autocompact
//                 is off, emit one-shot warnings at 80/90/98%.
// Collaborators: hooks/useSend.ts, stores/conversationsStore,
//                context/builder, conversations/compact.
// ------------------------------------------------------------------

import type { Conversation, Persona } from "../types";
import { PROVIDER_REGISTRY } from "../providers/registry";

const WARNING_THRESHOLDS = [80, 90, 98];

export interface AutocompactContext {
  conversation: Conversation;
  personas: Persona[];
}

/**
 * Compute the tightest maxContextTokens across the selected personas.
 */
function tightestMaxTokens(personas: readonly Persona[]): number {
  if (personas.length === 0) return Infinity;
  return Math.min(
    ...personas.map((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens),
  );
}

/**
 * Names of the persona(s) whose provider has the tightest maxContextTokens.
 * Used in compaction warnings so the user knows who's driving the threshold.
 */
export function tightestPersonaNames(personas: readonly Persona[]): string[] {
  if (personas.length === 0) return [];
  const tightest = tightestMaxTokens(personas);
  if (!Number.isFinite(tightest)) return [];
  return personas
    .filter((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens === tightest)
    .map((p) => p.name);
}

/**
 * Resolve the effective autocompact token threshold.
 * Returns null if autocompact is off.
 */
export function resolveAutocompactTokens(
  conversation: Conversation,
  personas: readonly Persona[],
): number | null {
  const threshold = conversation.autocompactThreshold;
  if (!threshold) return null;
  if (threshold.mode === "kTokens") return threshold.value * 1000;
  // percent mode
  const maxTokens = tightestMaxTokens(personas);
  if (!Number.isFinite(maxTokens)) return null;
  return Math.floor((threshold.value / 100) * maxTokens);
}

/**
 * Given current context token count and tightest model limit, return
 * warning thresholds that should fire (haven't fired yet).
 * Returns empty array if autocompact is on or no warnings needed.
 */
export function pendingWarnings(
  conversation: Conversation,
  currentTokens: number,
  personas: readonly Persona[],
): number[] {
  // Autocompact is on — no warnings.
  if (conversation.autocompactThreshold) return [];
  const maxTokens = tightestMaxTokens(personas);
  if (!Number.isFinite(maxTokens)) return [];
  const fired = conversation.contextWarningsFired ?? [];
  const result: number[] = [];
  for (const pct of WARNING_THRESHOLDS) {
    if (fired.includes(pct)) continue;
    const limit = Math.floor((pct / 100) * maxTokens);
    if (currentTokens >= limit) result.push(pct);
  }
  return result;
}
