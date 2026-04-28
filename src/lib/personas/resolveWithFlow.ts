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

// Walk the flow forward from current_step_index, wrapping to step 0 at
// the end, and return the first `personas` step encountered. Returns
// null if no `personas` step exists in the flow.
function nextPersonasStep(flow: Flow): Flow["steps"][number] | null {
  const n = flow.steps.length;
  if (n === 0) return null;
  for (let i = 0; i < n; i++) {
    const idx = (flow.currentStepIndex + i) % n;
    const step = flow.steps[idx];
    if (step?.kind === "personas") return step;
  }
  return null;
}
