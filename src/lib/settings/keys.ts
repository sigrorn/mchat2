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

// Idle timeout on streaming SSE reads (#124). If no bytes arrive on the
// reader for this many ms, the watchdog cancels the stream and surfaces
// a transient 408 so retryManager retries. Stored as an integer string.
export const IDLE_TIMEOUT_MS_KEY = "general.idleTimeoutMs";
export const DEFAULT_IDLE_TIMEOUT_MS = 50_000;

// Max retry attempts for transient stream errors (#124). Paired with
// the idle-timeout setting: the watchdog produces transient 408s,
// retryManager honors this attempt cap. Stored as an integer string.
export const MAX_RETRY_ATTEMPTS_KEY = "general.maxRetryAttempts";
export const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
