// ------------------------------------------------------------------
// Component: Boolean-setting parser
// Responsibility: Shared null/empty/invalid → default coercion for
//                 persisted boolean settings. One rule, one place.
// Collaborators: stores/uiStore.ts (streamResponses, panel collapse
//                toggles).
// ------------------------------------------------------------------

/**
 * Coerce a persisted string into a boolean. Null, empty string, and
 * any non-"true"/"false" literal all fall back to `defaultValue`.
 * Case-sensitive — the setters write "true"/"false" lowercase.
 */
export function parseBoolSetting(raw: string | null, defaultValue: boolean): boolean {
  if (raw === null || raw === "") return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return defaultValue;
}
