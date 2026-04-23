// ------------------------------------------------------------------
// Component: Per-persona timing aggregator
// Responsibility: Compute average TTFT and average tokens/sec for a
//                 single persona across successful streamed assistant
//                 rows, filtered to the current checkpoint (#122).
// Collaborators: lib/commands/stats.ts.
// ------------------------------------------------------------------

import type { Message, Persona } from "../types";

export interface PersonaTimingStats {
  /** Average TTFT in milliseconds, or null if no eligible data. */
  avgTtftMs: number | null;
  /** Average output tokens per second, or null if no eligible data. */
  avgTokensPerSec: number | null;
}

/**
 * Aggregate per-persona streaming timings since the last checkpoint.
 *
 * Eligibility for TTFT: persona's non-failed assistant rows with
 * non-null ttft_ms, index >= floor.
 *
 * Eligibility for tok/s: same as TTFT plus stream_ms > 0 and
 * output_tokens > 1 (guards against divide-by-near-zero and the noise
 * of trivially short streams).
 */
export function aggregatePersonaTimings(
  persona: Persona,
  messages: readonly Message[],
  compactionFloor: number,
): PersonaTimingStats {
  let ttftSum = 0;
  let ttftCount = 0;
  let tpsSum = 0;
  let tpsCount = 0;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (m.personaId !== persona.id) continue;
    if (m.errorMessage !== null) continue;
    if (m.index < compactionFloor) continue;
    if (typeof m.ttftMs === "number") {
      ttftSum += m.ttftMs;
      ttftCount++;
    }
    if (
      typeof m.streamMs === "number" &&
      m.streamMs > 0 &&
      typeof m.outputTokens === "number" &&
      m.outputTokens > 1
    ) {
      const tokensPerSec = m.outputTokens / (m.streamMs / 1000);
      tpsSum += tokensPerSec;
      tpsCount++;
    }
  }
  return {
    avgTtftMs: ttftCount > 0 ? ttftSum / ttftCount : null,
    avgTokensPerSec: tpsCount > 0 ? tpsSum / tpsCount : null,
  };
}
