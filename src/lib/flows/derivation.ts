// ------------------------------------------------------------------
// Component: Flow derivation (#215, slice 3 of #212)
// Responsibility: Pure level-grouping topological sort. Turns a
//                 persona DAG (legacy runs_after edges) into a
//                 FlowDraft: alternating `user` / `personas` steps,
//                 where each `personas` step is one DAG level.
// History:        Phase C of #241 dropped the runs_after column,
//                 so this function now operates on a transient
//                 Map<personaId, parentIds[]> the caller provides
//                 — typically built from a legacy import file.
// Collaborators: lib/types/flow (FlowDraft), components/FlowEditor.
// Pure — no DB access, no globals.
// ------------------------------------------------------------------

import type { FlowDraft, FlowDraftStep, Persona } from "../types";

export function derivedFlowFromRunsAfter(
  personas: readonly Persona[],
  runsAfter: ReadonlyMap<string, readonly string[]>,
): FlowDraft {
  const live = personas.filter((p) => p.deletedAt === null);
  if (live.length === 0) return { currentStepIndex: 0, steps: [] };

  const liveIds = new Set(live.map((p) => p.id));
  // Edges restricted to live personas — tombstoned parents are dropped
  // (the same persona is treated as a root if all its parents are
  // tombstoned).
  const parentsById = new Map<string, string[]>();
  for (const p of live) {
    const declared = runsAfter.get(p.id) ?? [];
    parentsById.set(p.id, declared.filter((pid) => liveIds.has(pid)));
  }

  const levelById = new Map<string, number>();
  // Iterate until every live persona has a level. Cycles are
  // impossible for legacy data (service-layer cycle check ran at
  // write time pre-Phase A); the safety counter still bounds runtime
  // for any data that slipped through.
  let changed = true;
  let safety = live.length + 1;
  while (changed && safety-- > 0) {
    changed = false;
    for (const p of live) {
      if (levelById.has(p.id)) continue;
      const parents = parentsById.get(p.id) ?? [];
      if (parents.length === 0) {
        levelById.set(p.id, 0);
        changed = true;
        continue;
      }
      let maxParent = -1;
      let allKnown = true;
      for (const pid of parents) {
        const lvl = levelById.get(pid);
        if (lvl === undefined) {
          allKnown = false;
          break;
        }
        if (lvl > maxParent) maxParent = lvl;
      }
      if (allKnown) {
        levelById.set(p.id, maxParent + 1);
        changed = true;
      }
    }
  }

  // Bucket personas by level, then emit alternating steps.
  const byLevel = new Map<number, string[]>();
  let maxLevel = 0;
  for (const [id, lvl] of levelById) {
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(id);
    if (lvl > maxLevel) maxLevel = lvl;
  }
  for (const [, ids] of byLevel) ids.sort();

  const steps: FlowDraftStep[] = [];
  steps.push({ kind: "user", personaIds: [] });
  for (let lvl = 0; lvl <= maxLevel; lvl++) {
    const ids = byLevel.get(lvl) ?? [];
    if (ids.length === 0) continue;
    steps.push({ kind: "personas", personaIds: ids });
    steps.push({ kind: "user", personaIds: [] });
  }

  return { currentStepIndex: 0, steps };
}
