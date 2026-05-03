// ------------------------------------------------------------------
// Component: Per-persona cost aggregator
// Responsibility: Roll up assistant-message token usage into a USD
//                 cost per persona key, tagging the result approximate
//                 if any contributing row was approximate.
// Collaborators: pricing/estimator.ts, UI persona panel.
// ------------------------------------------------------------------

import type { Message, Persona } from "../types";
import { estimateCost, type CostResult } from "./estimator";

export function computePersonaCosts(
  messages: readonly Message[],
  personas: readonly Persona[],
): Record<string, CostResult> {
  const keys = new Set(personas.map((p) => p.id));
  const out: Record<string, CostResult> = {};
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (!m.personaId || !keys.has(m.personaId)) continue;
    if (!m.provider || !m.model) continue;
    if (m.inputTokens === 0 && m.outputTokens === 0) continue;
    // #252: prefer the per-message cost snapshot when present. It was
    // computed against PRICING at completion time, so historical
    // figures stay stable across pricing-table edits. Pre-#252 rows
    // (and rows whose model wasn't in PRICING when the migration ran)
    // fall back to the live estimator, which has a median fallback to
    // keep panels populated when a brand-new model lands.
    const r: CostResult =
      m.costUsd != null
        ? { usd: m.costUsd, approximate: m.usageEstimated }
        : estimateCost({
            provider: m.provider,
            model: m.model,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            estimated: m.usageEstimated,
          });
    const prev = out[m.personaId];
    out[m.personaId] = prev
      ? { usd: prev.usd + r.usd, approximate: prev.approximate || r.approximate }
      : r;
  }
  return out;
}

export function formatPersonaCost(r: CostResult | undefined): string {
  if (!r || r.usd === 0) return "—";
  const prefix = r.approximate ? "~$" : "$";
  return `${prefix}${r.usd.toFixed(4)}`;
}
