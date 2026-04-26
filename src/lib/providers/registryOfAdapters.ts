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
import { openaiAdapter, perplexityAdapter, mistralAdapter } from "./openaiCompat";
import { apertusAdapter } from "./apertus";
import { geminiAdapter } from "./gemini";
import { openaiCompatTemplatedAdapter } from "./openaiCompatTemplated";

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
  mistral: mistralAdapter,
  apertus: apertusAdapter,
  openai_compat: openaiCompatTemplatedAdapter,
  mock: mockAdapter,
};

export function adapterFor(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id];
}
