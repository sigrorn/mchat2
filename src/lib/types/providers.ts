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
  // #257 Phase B: legacy native 'apertus' provider removed. The
  // Infomaniak endpoint it exposed lives on as the openai_compat
  // built-in 'infomaniak' preset; legacy data was auto-converted by
  // #255 (Phase 0). Code paths still need to recognise 'apertus' as
  // an *input* string in legacy snapshots — the conversion in
  // migrateApertusToOpenaiCompat handles that and never produces
  // ProviderId === 'apertus' in new data.
  // #140 → #169: meta-provider for OpenAI-compatible endpoints.
  // Resolves to a concrete preset (OpenRouter / OVHcloud / IONOS /
  // Infomaniak / custom) per persona via openaiCompatPresets +
  // openaiCompatStorage; the adapter reads url + headers from
  // extraConfig at call time.
  | "openai_compat"
  | "mock";
