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
  // Alternate @-prefixes accepted by the resolver (#41). Useful for
  // name parity with old mchat and with each provider's ecosystem
  // jargon (@openai alongside @gpt, @anthropic alongside @claude).
  // Must not collide with any other provider's prefix or alias.
  aliases?: readonly string[];
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
  // Maximum context tokens the provider's default model accepts (#55).
  // buildContext truncates history to stay under this. Infinity = no limit.
  maxContextTokens: number;
  // #141 phase 1 — ISO 3166 alpha-2 country code for where the API
  // endpoint is hosted. Surfaces as `[CH]` / `[FR]` etc. in the model
  // picker and persona row. null only for non-hosted providers (mock).
  hostingCountry: string | null;
}

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: "claude",
    displayName: "Claude",
    prefix: "claude",
    aliases: ["anthropic"],
    defaultModel: "claude-sonnet-4-6",
    color: "#d97706",
    keychainKey: "anthropic_api_key",
    requiresKey: true,
    maxContextTokens: 200000,
    hostingCountry: "US",
  },
  openai: {
    id: "openai",
    displayName: "GPT",
    prefix: "gpt",
    aliases: ["openai"],
    defaultModel: "gpt-4o",
    color: "#10a37f",
    keychainKey: "openai_api_key",
    requiresKey: true,
    maxContextTokens: 128000,
    hostingCountry: "US",
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    prefix: "gemini",
    aliases: ["google"],
    defaultModel: "gemini-1.5-pro",
    color: "#4285f4",
    keychainKey: "google_api_key",
    requiresKey: true,
    maxContextTokens: 1048576,
    hostingCountry: "US",
  },
  perplexity: {
    id: "perplexity",
    displayName: "Perplexity",
    prefix: "perplexity",
    defaultModel: "llama-3.1-sonar-large-128k-online",
    color: "#1fb8cd",
    keychainKey: "perplexity_api_key",
    requiresKey: true,
    maxContextTokens: 127072,
    hostingCountry: "US",
  },
  mistral: {
    id: "mistral",
    displayName: "Mistral",
    prefix: "mistral",
    aliases: ["mistralai"],
    defaultModel: "mistral-large-latest",
    color: "#ff7000",
    keychainKey: "mistral_api_key",
    requiresKey: true,
    maxContextTokens: 128000,
    hostingCountry: "FR",
  },
  apertus: {
    id: "apertus",
    displayName: "Apertus",
    prefix: "apertus",
    aliases: ["swissai", "infomaniak"],
    defaultModel: "swiss-ai/Apertus-70B-Instruct-2509",
    color: "#8b5cf6",
    keychainKey: "apertus_api_key",
    requiresKey: true,
    maxContextTokens: 16384,
    hostingCountry: "CH",
  },
  mock: {
    id: "mock",
    displayName: "Mock",
    prefix: "mock",
    defaultModel: "mock-1",
    color: "#6b7280",
    keychainKey: "mock_api_key",
    requiresKey: false,
    maxContextTokens: Infinity,
    hostingCountry: null,
  },
  // #140 → #169: meta-provider entry. Real per-persona display
  // (color, hosting country, default model, max-context) comes from
  // the resolved preset, not from these placeholder values. The
  // entry exists so adapterFor("openai_compat") and provider-keyed
  // lookups don't throw before phase C wires preset-aware rendering.
  openai_compat: {
    id: "openai_compat",
    displayName: "OpenAI-compatible",
    prefix: "openai_compat",
    defaultModel: "",
    color: "#475569",
    keychainKey: "openai_compat.apiKey",
    requiresKey: false,
    maxContextTokens: Infinity,
    hostingCountry: null,
  },
};

export const ALL_PROVIDER_IDS: readonly ProviderId[] = Object.freeze(
  Object.keys(PROVIDER_REGISTRY) as ProviderId[],
);
