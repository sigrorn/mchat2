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
import { geminiAdapter } from "./gemini";
import { openaiCompatTemplatedAdapter } from "./openaiCompatTemplated";

// #257 Phase B: native apertus adapter removed. Personas that pointed
// at the legacy provider were auto-converted to openai_compat with
// the Infomaniak preset (#255 Phase 0); the openai_compat adapter
// covers the same wire format.
export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
  mistral: mistralAdapter,
  openai_compat: openaiCompatTemplatedAdapter,
  mock: mockAdapter,
};

export function adapterFor(id: ProviderId): ProviderAdapter {
  return ADAPTERS[id];
}
