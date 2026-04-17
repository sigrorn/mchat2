// ------------------------------------------------------------------
// Component: Providers barrel
// Responsibility: Public surface of the providers module
// ------------------------------------------------------------------

export { PROVIDER_REGISTRY, ALL_PROVIDER_IDS } from "./registry";
export type { ProviderMeta } from "./registry";
export type { ProviderAdapter, StreamArgs, ChatMessage } from "./adapter";
export { mockAdapter } from "./mock";
export { anthropicAdapter } from "./anthropic";
export { geminiAdapter } from "./gemini";
export {
  openaiAdapter,
  perplexityAdapter,
  mistralAdapter,
  createOpenAICompatAdapter,
} from "./openaiCompat";
export { apertusAdapter } from "./apertus";
export { ADAPTERS, adapterFor } from "./registryOfAdapters";
export { listModels, listModelInfos, formatTokenLimit } from "./models";
export type { ModelInfo } from "./models";
export {
  PREFIX_TO_PROVIDER,
  PROVIDER_COLORS,
  PROVIDER_DISPLAY_NAMES,
  RESERVED_PERSONA_NAMES,
  isReservedName,
  providerForPrefix,
} from "./derived";
