// ------------------------------------------------------------------
// Component: Settings keys
// Responsibility: Centralized constants for the flat settings key/value
//                 keyspace. Keeps the strings out of UI files and gives
//                 grep a single anchor point.
// Collaborators: persistence/settings.ts, components/SettingsGeneralDialog.
// ------------------------------------------------------------------

// App-wide system prompt prepended above persona/conversation tier (#23).
export const GLOBAL_SYSTEM_PROMPT_KEY = "general.systemPrompt";

// #259 Phase D: APERTUS_PRODUCT_ID_KEY removed. The product-id moved
// onto the openai_compat infomaniak preset's PRODUCT_ID template var
// in #255 Phase 0; the orphan setting row is dropped from the
// keychain at launch by dropApertusKeychainResidue.

// User-chosen working directory for import/export dialogs and debug
// trace files (#46). Required before the debug toggle is enabled.
export const GENERAL_WORKING_DIR_KEY = "general.workingDir";

// Idle timeout on streaming SSE reads (#124). If no bytes arrive on the
// reader for this many ms, the watchdog cancels the stream and surfaces
// a transient 408 so retryManager retries. Stored as an integer string.
// Typed accessor: see lib/settings/registry.ts.
export const IDLE_TIMEOUT_MS_KEY = "general.idleTimeoutMs";
export const DEFAULT_IDLE_TIMEOUT_MS = 50_000;

// Max retry attempts for transient stream errors (#124). Paired with
// the idle-timeout setting: the watchdog produces transient 408s,
// retryManager honors this attempt cap. Stored as an integer string.
// Typed accessor: see lib/settings/registry.ts.
export const MAX_RETRY_ATTEMPTS_KEY = "general.maxRetryAttempts";
export const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
