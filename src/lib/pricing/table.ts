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

// Updated 2026-05-04. Values are representative, not authoritative — a
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
    // 2.5 series — current default tier. Pricing per Google's Gemini API
    // page (≤200k context for 2.5 Pro; the >200k tier costs 2× and isn't
    // captured here — bump if a receipt shows the higher tier was used).
    "gemini-2.5-pro": { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10 },
    "gemini-2.5-flash": { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
    "gemini-2.5-flash-lite": { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.4 },
    // 1.5 series — kept for back-compat with conversations whose personas
    // still target these older model ids. New rows shouldn't see them.
    "gemini-1.5-pro": { inputUsdPerMTok: 1.25, outputUsdPerMTok: 5 },
    "gemini-1.5-flash": { inputUsdPerMTok: 0.075, outputUsdPerMTok: 0.3 },
  },
  perplexity: {
    "llama-3.1-sonar-large-128k-online": { inputUsdPerMTok: 1, outputUsdPerMTok: 1 },
  },
  mistral: {
    "mistral-large-latest": { inputUsdPerMTok: 2, outputUsdPerMTok: 6 },
  },
  // #257 Phase B: native PRICING.apertus removed. The same model ids
  // live under PRICING.openai_compat (#255 Phase 0); converted personas
  // get correct cost snapshots from there.
  mock: {
    "mock-1": { inputUsdPerMTok: 0, outputUsdPerMTok: 0 },
  },
  // #169: openai_compat is preset-routed; concrete pricing varies per
  // host and per model. #255 adds the four Infomaniak/Apertus model
  // ids that previously lived under PRICING.apertus, so when an
  // apertus persona converts to openai_compat (Infomaniak preset) the
  // spend table keeps populating instead of dropping to "?". Other
  // preset-specific rates can land here as they're confirmed against
  // user receipts.
  openai_compat: {
    "swiss-ai/Apertus-70B-Instruct-2509": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
    "openai/gpt-oss-120b": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
    "Llama-3.3-70B-Instruct": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
    "Mistral-Small-3.2-24B-Instruct-2506": { inputUsdPerMTok: 0.5, outputUsdPerMTok: 1.5 },
  },
};
