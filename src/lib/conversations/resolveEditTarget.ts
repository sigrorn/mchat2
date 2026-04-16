// ------------------------------------------------------------------
// Component: Edit-target resolver
// Responsibility: Map the //edit command's optional signed integer to
//                 a specific user-role Message in the current history.
//                 Pure so the Composer dispatcher can stay thin.
// Collaborators: components/Composer (runCommand edit branch).
// ------------------------------------------------------------------

import type { Message } from "../types";

// null → last user message
// positive N → Nth user message (1-indexed)
// negative N → Nth-last (so -1 is last, -2 is second-to-last, ...)
export function resolveEditTarget(
  messages: readonly Message[],
  userNumber: number | null,
): Message | null {
  const users = messages.filter((m) => m.role === "user");
  if (users.length === 0) return null;
  if (userNumber === null) return users[users.length - 1] ?? null;
  if (userNumber > 0) {
    return users[userNumber - 1] ?? null;
  }
  // userNumber < 0; -1 is last.
  const idx = users.length + userNumber;
  return users[idx] ?? null;
}
