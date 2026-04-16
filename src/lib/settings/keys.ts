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

// User-chosen working directory for import/export dialogs and debug
// trace files (#46). Required before the debug toggle is enabled.
export const GENERAL_WORKING_DIR_KEY = "general.workingDir";
