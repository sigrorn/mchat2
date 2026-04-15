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
  | "mock";
