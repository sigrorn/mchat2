// ------------------------------------------------------------------
// Component: Visibility presets
// Responsibility: Compute the visDefs + seenByEdits maps for the
//                 three persona "role" presets the form exposes
//                 (#173): Speaker, Participant, Observer. Pure-data
//                 helper so PersonaFormFields stays a thin caller —
//                 the React layer just spreads the result into its
//                 existing onChange handlers.
// Collaborators: components/PersonaFormFields (sole consumer).
// ------------------------------------------------------------------

import type { Persona } from "../types";

export type VisibilityRole = "speaker" | "participant" | "observer";

export interface VisibilityPresetResult {
  // Keyed by sibling persona's nameSlug, matching the shape the
  // form's local state and the persisted visibility_defaults column
  // already use.
  visDefs: Record<string, "y" | "n">;
  seenByEdits: Record<string, "y" | "n">;
}

// Pre-set role semantics:
//
//   Speaker     — voice-only; doesn't listen to others, but everyone
//                 hears them.        sees=n  seen=y
//   Participant — full duplex.       sees=y  seen=y
//   Observer    — eyes-only; sees    sees=y  seen=n
//                 everything,
//                 contributes
//                 invisibly.
//
// Speaker and Observer are mirror opposites, which the test suite
// double-checks. Full isolation (sees=n seen=n) isn't a preset
// because it's rare and one hand-toggle away.
const ROLE_TABLE: Record<VisibilityRole, { sees: "y" | "n"; seen: "y" | "n" }> = {
  speaker: { sees: "n", seen: "y" },
  participant: { sees: "y", seen: "y" },
  observer: { sees: "y", seen: "n" },
};

export function applyVisibilityPreset(
  role: VisibilityRole,
  siblings: readonly Persona[],
): VisibilityPresetResult {
  const { sees, seen } = ROLE_TABLE[role];
  const visDefs: Record<string, "y" | "n"> = {};
  const seenByEdits: Record<string, "y" | "n"> = {};
  for (const p of siblings) {
    visDefs[p.nameSlug] = sees;
    seenByEdits[p.nameSlug] = seen;
  }
  return { visDefs, seenByEdits };
}
