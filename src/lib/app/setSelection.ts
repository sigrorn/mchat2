// ------------------------------------------------------------------
// Component: setSelection use case
// Responsibility: First slice of #271 — separate the persistent mutation
//                 (writing the conversation row's selectedPersonas) from
//                 the transient UI cache update (the persona checkbox
//                 state). Today the personasStore conflates the two by
//                 calling useConversationsStore from inside its
//                 setSelection action; this use case is the lib/app
//                 boundary the persistent half moves into.
// Collaborators: hooks/commandDeps wires the deps; UI callers (Composer,
//                PersonaPanel) reach the use case through deps rather
//                than the store directly.
// ------------------------------------------------------------------

export interface SetSelectionDeps {
  /** Apply the new selection to the local cache (zustand UI state).
   *  Synchronous — UI feedback should land before the persistent
   *  write resolves. */
  setLocalSelection: (conversationId: string, keys: readonly string[]) => void;
  /** Persist the new selection on the conversation row. Returns once
   *  the write lands; rejection bubbles to the caller's error handler
   *  (typically backgroundTask). */
  setSelectedPersonasPersistent: (
    conversationId: string,
    keys: readonly string[],
  ) => Promise<void>;
}

/**
 * Apply a new persona selection for `conversationId`. Local cache is
 * updated first so the UI feels instant; the persistent write follows.
 * A persistence failure is propagated — callers wrap with
 * `backgroundTask("setSelection", ...)` when they want best-effort
 * semantics.
 */
export async function setSelection(
  deps: SetSelectionDeps,
  conversationId: string,
  keys: readonly string[],
): Promise<void> {
  deps.setLocalSelection(conversationId, keys);
  await deps.setSelectedPersonasPersistent(conversationId, keys);
}
