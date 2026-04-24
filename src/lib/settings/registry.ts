// ------------------------------------------------------------------
// Component: Typed settings registry
// Responsibility: One registered accessor per typed setting. Callers
//                 import the accessor instead of re-implementing
//                 parseInt/bounds/fallback logic (#126).
// Collaborators: lib/settings/typed.ts, lib/settings/keys.ts.
// ------------------------------------------------------------------

import { defineNumberSetting } from "./typed";
import {
  IDLE_TIMEOUT_MS_KEY,
  DEFAULT_IDLE_TIMEOUT_MS,
  MAX_RETRY_ATTEMPTS_KEY,
  DEFAULT_MAX_RETRY_ATTEMPTS,
} from "./keys";

/** SSE idle-timeout watchdog window, ms. See #124. */
export const idleTimeoutMs = defineNumberSetting(IDLE_TIMEOUT_MS_KEY, {
  default: DEFAULT_IDLE_TIMEOUT_MS,
  min: 1,
});

/** Max retry attempts for transient stream errors. See #124. */
export const maxRetryAttempts = defineNumberSetting(MAX_RETRY_ATTEMPTS_KEY, {
  default: DEFAULT_MAX_RETRY_ATTEMPTS,
  min: 1,
});
