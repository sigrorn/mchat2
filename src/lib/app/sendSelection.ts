// ------------------------------------------------------------------
// Component: Send-time selection helper
// Responsibility: Decide what the sidebar persona selection should
//                 become after a resolved send. Pure so the policy is
//                 unit-testable; useSend wires it to the personas
//                 store.
// Collaborators: hooks/useSend.ts, personas/resolver.ts.
// ------------------------------------------------------------------

import type { ResolveResult } from "@/lib/personas/resolver";

// An @-addressed run replaces selection with the resolver's actual
// target list. Implicit sends never disturb selection (otherwise a
// 'use what's selected' message would pointlessly rewrite the same
// selection in a render loop).
export function selectionAfterResolve(
  resolved: ResolveResult,
  current: readonly string[],
): string[] {
  if (resolved.mode === "implicit") return [...current];
  return resolved.targets.map((t) => t.key);
}
