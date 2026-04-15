// ------------------------------------------------------------------
// Component: Cost estimator
// Responsibility: Compute USD cost from token counts + model. Marks
//                 rows where the adapter approximated token counts so
//                 the UI can disclose "~" rather than present fake
//                 precision.
// Collaborators: pricing/table.ts, UI cost displays.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";
import { PRICING, type ModelPricing } from "./table";

export interface CostInput {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  // Whether the adapter reported usage itself or we approximated.
  estimated: boolean;
}

export interface CostResult {
  usd: number;
  // True when either the token counts were estimated OR the model was
  // unknown (fell back to provider defaults). UI should prefix "~".
  approximate: boolean;
}

export function estimateCost(input: CostInput): CostResult {
  const providerTable = PRICING[input.provider] ?? {};
  const entry: ModelPricing | undefined = providerTable[input.model];
  const approximate = input.estimated || entry === undefined;
  const pricing = entry ?? fallbackPricing(input.provider);
  const usd =
    (input.inputTokens / 1_000_000) * pricing.inputUsdPerMTok +
    (input.outputTokens / 1_000_000) * pricing.outputUsdPerMTok;
  return { usd, approximate };
}

// Unknown-model fallback: use the median of the provider's known rates
// so a newly-released model doesn't show $0 cost.
function fallbackPricing(provider: ProviderId): ModelPricing {
  const entries = Object.values(PRICING[provider] ?? {});
  if (entries.length === 0) return { inputUsdPerMTok: 0, outputUsdPerMTok: 0 };
  const med = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
  };
  return {
    inputUsdPerMTok: med(entries.map((e) => e.inputUsdPerMTok)),
    outputUsdPerMTok: med(entries.map((e) => e.outputUsdPerMTok)),
  };
}
