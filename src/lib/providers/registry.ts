// ------------------------------------------------------------------
// Component: Provider registry
// Responsibility: Single source of truth for provider metadata — id,
//                 display name, @-prefix, default model, color, key env
//                 name. Every derived map (prefix→id, id→color, etc.)
//                 is computed from this object so adding a provider is
//                 a one-line change.
// Collaborators: providers/derived.ts, personas/resolver.ts, UI theme.
// ------------------------------------------------------------------

import type { ProviderId } from "../types";

export interface ProviderMeta {
  id: ProviderId;
  displayName: string;
  // @-prefix used in message input for targeting. Lowercase, unique.
  prefix: string;
  // Suggested default model id shown in the model picker when the user
  // first selects the provider. Can be overridden per-persona.
  defaultModel: string;
  // Tailwind-friendly hex used as the default persona color for this
  // provider. Personas can override.
  color: string;
  // Keychain entry name (stable, never localized).
  keychainKey: string;
  // Whether the adapter requires an API key. The mock provider does not.
  requiresKey: boolean;
}

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: "claude",
    displayName: "Claude",
    prefix: "claude",
    defaultModel: "claude-sonnet-4-6",
    color: "#d97706",
    keychainKey: "anthropic_api_key",
    requiresKey: true,
  },
  openai: {
    id: "openai",
    displayName: "GPT",
    prefix: "gpt",
    defaultModel: "gpt-4o",
    color: "#10a37f",
    keychainKey: "openai_api_key",
    requiresKey: true,
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    prefix: "gemini",
    defaultModel: "gemini-1.5-pro",
    color: "#4285f4",
    keychainKey: "google_api_key",
    requiresKey: true,
  },
  perplexity: {
    id: "perplexity",
    displayName: "Perplexity",
    prefix: "perplexity",
    defaultModel: "llama-3.1-sonar-large-128k-online",
    color: "#1fb8cd",
    keychainKey: "perplexity_api_key",
    requiresKey: true,
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral",
    prefix: "mistral",
    defaultModel: "mistral-large-latest",
    color: "#ff7000",
    keychainKey: "mistral_api_key",
    requiresKey: true,
  },
  apertus: {
    id: "apertus",
    displayName: "Apertus",
    prefix: "apertus",
    defaultModel: "swiss-ai/Apertus-70B-Instruct-2509",
    color: "#8b5cf6",
    keychainKey: "apertus_api_key",
    requiresKey: true,
  },
  mock: {
    id: "mock",
    displayName: "Mock",
    prefix: "mock",
    defaultModel: "mock-1",
    color: "#6b7280",
    keychainKey: "mock_api_key",
    requiresKey: false,
  },
};

export const ALL_PROVIDER_IDS: readonly ProviderId[] = Object.freeze(
  Object.keys(PROVIDER_REGISTRY) as ProviderId[],
);
