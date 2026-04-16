// ------------------------------------------------------------------
// Component: Font scale step helper
// Responsibility: Discrete zoom levels for the chat + composer (#50).
//                 Pure helpers; persistence lives in a store that
//                 reads/writes the settings table.
// Collaborators: App root keybindings, MessageList / Composer styles.
// ------------------------------------------------------------------

// 80% → 90% → 100% → 115% → 130% → 150% → 175% → 200%. Sorted ascending
// so index arithmetic works cleanly.
export const SCALE_STEPS: readonly number[] = Object.freeze([
  0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0,
]);

export const DEFAULT_SCALE = 1;

export type ScaleDirection = "up" | "down" | "reset";

export function nextScale(current: number, direction: ScaleDirection): number {
  if (direction === "reset") return DEFAULT_SCALE;
  if (direction === "up") {
    const next = SCALE_STEPS.find((s) => s > current);
    return next ?? SCALE_STEPS[SCALE_STEPS.length - 1]!;
  }
  // direction === "down"
  for (let i = SCALE_STEPS.length - 1; i >= 0; i--) {
    const s = SCALE_STEPS[i]!;
    if (s < current) return s;
  }
  return SCALE_STEPS[0]!;
}
