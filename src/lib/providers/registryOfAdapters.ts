// ------------------------------------------------------------------
// Component: Adapter registry
// Responsibility: One-stop-shop for locating the adapter for a given
//                 ProviderId. Centralized so useSend can drop its
//                 hardcoded ADAPTERS object.
// Collaborators: hooks/useSend.ts.
// ------------------------------------------------------------------

import type { ProviderAdapter } from "./adapter";
import type { ProviderId } from "../types";
import { mockAdapter } from "./mock";
import { anthropicAdapter } from "./anthropic";
import { openaiAdapter, perplexityAdapter, mistralAdapter, apertusAdapter } from "./openaiCompat";
import { geminiAdapter } from "./gemini";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
  mistral: mistralAdapter,
  apertus: apertusAdapter,
  mock: mockAdapter,
};

export function adapterFor(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id];
}
