// ------------------------------------------------------------------
// Component: Pricing table
// Responsibility: Static per-million-token prices for known models.
//                 Kept as code, not config, so it lives under version
//                 control and review. Out-of-table models fall back to
//                 the provider's "unknown model" estimate.
// Collaborators: pricing/estimator.ts, UI cost chips.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";

export interface ModelPricing {
  // Both prices are USD per million tokens.
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export type PricingTable = Record<ProviderId, Record<string, ModelPricing>>;

// Updated 2026-04-15. Values are representative, not authoritative — a
// receipt from the provider is the ground truth. Review quarterly.
export const PRICING: PricingTable = {
  claude: {
    "claude-opus-4-6": { inputUsdPerMTok: 15, outputUsdPerMTok: 75 },
    "claude-sonnet-4-6": { inputUsdPerMTok: 3, outputUsdPerMTok: 15 },
    "claude-haiku-4-5-20251001": { inputUsdPerMTok: 0.8, outputUsdPerMTok: 4 },
  },
  openai: {
    "gpt-4o": { inputUsdPerMTok: 2.5, outputUsdPerMTok: 10 },
    "gpt-4o-mini": { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0.6 },
  },
  gemini: {
    "gemini-1.5-pro": { inputUsdPerMTok: 1.25, outputUsdPerMTok: 5 },
    "gemini-1.5-flash": { inputUsdPerMTok: 0.075, outputUsdPerMTok: 0.3 },
  },
  perplexity: {
    "llama-3.1-sonar-large-128k-online": { inputUsdPerMTok: 1, outputUsdPerMTok: 1 },
  },
  mistral: {
    "mistral-large-latest": { inputUsdPerMTok: 2, outputUsdPerMTok: 6 },
  },
  apertus: {
    "apertus-70b": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
  },
  mock: {
    "mock-1": { inputUsdPerMTok: 0, outputUsdPerMTok: 0 },
  },
};
