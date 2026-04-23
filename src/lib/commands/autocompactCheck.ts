// ------------------------------------------------------------------
// Component: Autocompact check
// Responsibility: After each response round, decide whether to fire
//                 80/90/98% context warnings or trigger autocompact.
//                 All checks are per-persona: a warning fires when ANY
//                 persona's own context is at or above the threshold
//                 of ITS OWN model's max-context window (#118).
// Collaborators: hooks/postResponseCheck.ts, stores/conversationsStore.
// ------------------------------------------------------------------

import type { Conversation, Persona } from "../types";
import { PROVIDER_REGISTRY } from "../providers/registry";

const WARNING_THRESHOLDS = [80, 90, 98];

export interface PersonaUsage {
  persona: Persona;
  /** Tokens currently in this persona's built context. */
  tokens: number;
  /** Max-context tokens for this persona's provider. */
  maxTokens: number;
}

/**
 * Return the integer percentage (0-100) this persona's context occupies
 * of its own max. Unlimited providers return 0.
 */
function usageRatio(u: PersonaUsage): number {
  if (!Number.isFinite(u.maxTokens) || u.maxTokens <= 0) return 0;
  return (u.tokens / u.maxTokens) * 100;
}

/**
 * Compute the tightest maxContextTokens across the personas.
 */
function tightestMaxTokens(personas: readonly Persona[]): number {
  if (personas.length === 0) return Infinity;
  return Math.min(...personas.map((p) => PROVIDER_REGISTRY[p.provider].maxContextTokens));
}

/**
 * Names of the persona(s) whose provider has the tightest maxContextTokens.
 * Kept for callers that still want to report "tightest model" info (e.g.,
 * diagnostic notices). Not used by the warning path anymore (#118).
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
 * Resolve the autocompact threshold as an absolute token count.
 * Only meaningful for kTokens mode. Percent mode requires per-persona
 * evaluation — callers should use autocompactTriggers() instead.
 *
 * Returns null when autocompact is off OR when the threshold is
 * percentage-based.
 */
export function resolveAutocompactTokens(conversation: Conversation): number | null {
  const threshold = conversation.autocompactThreshold;
  if (!threshold) return null;
  if (threshold.mode === "kTokens") return threshold.value * 1000;
  return null;
}

/**
 * Return the list of newly-crossed warning thresholds (80/90/98%),
 * excluding those already recorded in conversation.contextWarningsFired.
 * A threshold is "crossed" when ANY persona's own ratio meets or exceeds
 * it. Returns empty if autocompact is on or no threshold is crossed.
 *
 * Caller is responsible for recording the returned thresholds as fired
 * and for formatting the notice (see personasAtThreshold).
 */
export function pendingWarnings(
  conversation: Conversation,
  usages: readonly PersonaUsage[],
): number[] {
  if (conversation.autocompactThreshold) return [];
  if (usages.length === 0) return [];
  const fired = conversation.contextWarningsFired ?? [];
  const result: number[] = [];
  for (const pct of WARNING_THRESHOLDS) {
    if (fired.includes(pct)) continue;
    if (usages.some((u) => usageRatio(u) >= pct)) result.push(pct);
  }
  return result;
}

/**
 * Return the personas whose own context ratio is at or above the given
 * threshold percentage. Used to format warning notices.
 */
export function personasAtThreshold(
  threshold: number,
  usages: readonly PersonaUsage[],
): PersonaUsage[] {
  return usages.filter((u) => usageRatio(u) >= threshold);
}

/**
 * Return the personas whose context should trigger an autocompact.
 *
 * - kTokens mode: persona.tokens >= threshold*1000.
 * - percent mode: persona.ratio >= threshold%.
 *
 * Returns empty when autocompact is off or no persona triggers.
 */
export function autocompactTriggers(
  conversation: Conversation,
  usages: readonly PersonaUsage[],
): PersonaUsage[] {
  const threshold = conversation.autocompactThreshold;
  if (!threshold) return [];
  if (threshold.mode === "kTokens") {
    const limit = threshold.value * 1000;
    return usages.filter((u) => u.tokens >= limit);
  }
  // percent mode
  return usages.filter((u) => usageRatio(u) >= threshold.value);
}
