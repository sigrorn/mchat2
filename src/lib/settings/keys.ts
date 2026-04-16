// ------------------------------------------------------------------
// Component: Settings keys
// Responsibility: Centralized constants for the flat settings key/value
//                 keyspace. Keeps the strings out of UI files and gives
//                 grep a single anchor point.
// Collaborators: persistence/settings.ts, components/SettingsGeneralDialog.
// ------------------------------------------------------------------

// App-wide system prompt prepended above persona/conversation tier (#23).
export const GLOBAL_SYSTEM_PROMPT_KEY = "general.systemPrompt";

// Infomaniak Apertus account product id (#25). Account-level value that
// pairs with the API key, not with any individual persona.
export const APERTUS_PRODUCT_ID_KEY = "apertus.productId";

// Note: per-persona trace files (#40) are gated by the MCHAT2_DEBUG
// env var read once at process start, not a persisted setting — keeps
// the disk-fill foot-gun under per-launch user control.
