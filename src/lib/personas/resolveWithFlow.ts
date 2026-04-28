// ------------------------------------------------------------------
// Component: resolveTargetsWithFlow (#216, slice 4 of #212)
// Responsibility: Flow-aware wrapper around the pure resolveTargets.
//                 Inflates `@convo` (mode='convo') to the flow's next
//                 `personas` step's persona-set. Narrows `@all` to
//                 the same set when a flow is attached. All other
//                 modes pass through. Flow-position lookup is
//                 deliberately read-only — no cursor mutation.
// Collaborators: lib/personas/resolver, lib/types/flow,
//                lib/app/sendMessage (slice 5).
// ------------------------------------------------------------------

import type { Flow, Persona, PersonaTarget } from "../types";
import type { ResolveResult } from "./resolver";

export interface ResolveWithFlowOptions {
  flow: Flow | null;
  personas: readonly Persona[];
}

export function resolveTargetsWithFlow(
  base: ResolveResult,
  options: ResolveWithFlowOptions,
): ResolveResult {
  const { flow, personas } = options;

  if (base.mode === "convo") {
    if (!flow) return base; // no-op: no flow attached
    const stepTargets = nextPersonasStepTargets(flow, personas);
    return { ...base, targets: stepTargets };
  }

  if (base.mode === "all" && flow) {
    const stepTargets = nextPersonasStepTargets(flow, personas);
    if (stepTargets.length > 0) {
      return { ...base, targets: stepTargets };
    }
  }

  return base;
}

function nextPersonasStepTargets(
  flow: Flow,
  personas: readonly Persona[],
): PersonaTarget[] {
  const step = nextPersonasStep(flow);
  if (!step) return [];
  const personaById = new Map(personas.map((p) => [p.id, p] as const));
  const out: PersonaTarget[] = [];
  for (const id of step.personaIds) {
    const p = personaById.get(id);
    if (!p) continue;
    out.push({
      provider: p.provider,
      personaId: p.id,
      key: p.id,
      displayName: p.name,
    });
  }
  return out;
}

// Walk the flow forward from current_step_index and return the first
// `personas` step encountered. #220: when the walk passes the last
// step, it wraps to flow.loopStartIndex so the setup phase
// [0, loopStartIndex) is never re-entered. Returns null if no
// `personas` step exists in the cyclical range.
function nextPersonasStep(flow: Flow): Flow["steps"][number] | null {
  const n = flow.steps.length;
  if (n === 0) return null;
  const loopStart = flow.loopStartIndex;
  // Cap the walk at one full loop to avoid infinite scans on a flow
  // whose cycle has no personas-steps.
  let idx = flow.currentStepIndex;
  for (let i = 0; i < n; i++) {
    const step = flow.steps[idx];
    if (step?.kind === "personas") return step;
    idx = idx + 1 >= n ? loopStart : idx + 1;
  }
  return null;
}
