// ------------------------------------------------------------------
// Component: ProviderId
// Responsibility: Canonical provider identifier string union
// Collaborators: providers/registry.ts (single source of truth)
// ------------------------------------------------------------------

// Keep in sync with PROVIDER_REGISTRY keys. The registry is the source of
// truth; this type exists so other modules can be strongly typed without
// importing the registry object (which avoids circular imports).
export type ProviderId =
  | "claude"
  | "openai"
  | "gemini"
  | "perplexity"
  | "mistral"
  | "apertus"
  // #140 → #169: meta-provider for OpenAI-compatible endpoints.
  // Resolves to a concrete preset (OpenRouter / OVHcloud / IONOS /
  // Infomaniak / custom) per persona via openaiCompatPresets +
  // openaiCompatStorage; the adapter reads url + headers from
  // extraConfig at call time.
  | "openai_compat"
  | "mock";
