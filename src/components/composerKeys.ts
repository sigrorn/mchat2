// ------------------------------------------------------------------
// Component: Composer key helpers
// Responsibility: Decide, from a KeyboardEvent shape, whether it
//                 should trigger message submission. Extracted so the
//                 policy is unit-testable without a full textarea.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

export interface KeyboardEventLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

// Submit on Enter unless Shift is held (which inserts a newline). Ctrl
// and Cmd are accepted too, as muscle-memory aliases for users coming
// from the previous behavior where only Ctrl+Enter submitted.
export function shouldSubmit(e: KeyboardEventLike): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false;
  if (e.altKey) return false;
  return true;
}
