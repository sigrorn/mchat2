// ------------------------------------------------------------------
// Component: Composer placeholder builder
// Responsibility: Dynamic textarea placeholder text that reflects the
//                 current persona selection (#61). Parity with old
//                 mchat which adapted the prompt to the actual state.
// Collaborators: components/Composer.tsx.
// ------------------------------------------------------------------

import type { Persona } from "../types";

export function buildPlaceholder(
  personas: readonly Persona[],
  selection: readonly string[],
): string {
  if (personas.length === 0) {
    return "Add a persona to start chatting.";
  }
  if (selection.length > 0) {
    const names = selection
      .map((id) => personas.find((p) => p.id === id)?.name)
      .filter((n): n is string => !!n);
    if (names.length > 0) {
      return `Message to ${names.join(", ")}. Enter to send, Shift+Enter for newline.`;
    }
  }
  const available = personas.map((p) => `@${p.name}`).join(" ");
  return `Use ${available} or @all to target. Enter to send, Shift+Enter for newline.`;
}
