// ------------------------------------------------------------------
// Component: Compaction cutoff
// Responsibility: Compute the minimum message index to compact up to,
//                 preserving at least N recent visible messages per
//                 persona. Takes the minimum across personas so no
//                 persona loses its recent context.
// Collaborators: conversations/compactionRunner.ts.
// ------------------------------------------------------------------

import type { Conversation, Message, Persona } from "../types";

/**
 * Return true if this is a non-pinned user message visible to the
 * persona — the kind that counts as a "fresh conversational turn" for
 * last-N preservation. Pinned user messages (identity pins) and
 * assistant messages don't count.
 *
 * Exported so //stats (#119) can count the same kind of message the
 * //compact -N counter preserves.
 */
export function isCountableUserMessage(
  m: Message,
  personaKey: string,
): boolean {
  if (m.role !== "user") return false;
  if (m.pinned) return false;
  if (m.addressedTo.length > 0 && !m.addressedTo.includes(personaKey)) return false;
  return true;
}

/**
 * For a single persona, return the index of the N-th-from-last
 * non-pinned user message visible to them (restricted to indices >=
 * existing compactionFloor). If the persona has fewer than N, returns
 * null.
 */
function personaCutoff(
  persona: Persona,
  messages: readonly Message[],
  conversation: Conversation,
  n: number,
): number | null {
  const floor = conversation.compactionFloorIndex;
  const personaKey = persona.id;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (floor !== null && m.index < floor) break;
    if (!isCountableUserMessage(m, personaKey)) continue;
    count++;
    if (count === n) return m.index;
  }
  return null;
}

/**
 * Compute the compaction cutoff index given a preservation count N.
 *
 * Returns the index AT which the COMPACTION notice should be inserted.
 * All messages with `index < cutoff` are fed to the summarizer and
 * become excluded after compaction. All messages with `index >= cutoff`
 * are preserved verbatim.
 *
 * Semantics:
 * - N = 0 → returns messages.length (compact everything; preserve none).
 * - N >= total-visible for any persona → returns the conversation's
 *   existing compactionFloorIndex (or 0), meaning "nothing new to
 *   compact".
 * - Otherwise: min over personas of (index of the Nth-from-last
 *   countable message), clamped to be >= existing floor.
 */
export function computeCompactionCutoff(
  conversation: Conversation,
  messages: readonly Message[],
  personas: readonly Persona[],
  n: number,
): number {
  if (n <= 0) {
    // Compact everything — cutoff is past the last message.
    // If there are no messages yet, cutoff is 0.
    if (messages.length === 0) return 0;
    return messages[messages.length - 1]!.index + 1;
  }
  if (personas.length === 0) {
    if (messages.length === 0) return 0;
    return messages[messages.length - 1]!.index + 1;
  }
  if (messages.length === 0) return 0;

  const floor = conversation.compactionFloorIndex ?? 0;
  let minCutoff: number | null = null;
  for (const p of personas) {
    const cutoff = personaCutoff(p, messages, conversation, n);
    if (cutoff === null) {
      // Persona has fewer than N visible messages → cannot preserve N
      // for it, so nothing new to compact on its behalf. Fall back to
      // the existing floor so no compaction happens.
      return floor;
    }
    if (minCutoff === null || cutoff < minCutoff) minCutoff = cutoff;
  }
  if (minCutoff === null) return floor;
  return Math.max(minCutoff, floor);
}
