# 009 — Removing `runs_after` in favour of conversation flows

**Status:** accepted (#241, 2026-05-02)

## Context

Two ordering primitives coexisted through the conversation-flow
experiment (#212): the legacy `runs_after` persona-level DAG and
the new per-conversation flow step list. The deferral doc
[`docs/runs_after-removal-process.md`](../runs_after-removal-process.md)
parked the unification until flows had been validated end-to-end.

## Decision

Drop `runs_after` entirely:

- **Phase 0** — auto-derive a flow whenever legacy edges enter the
  system, on conversation open (Trigger A) and on persona / snapshot
  import (Trigger B). Append a trigger-specific notice; for imports,
  prompt the user to re-export so archived files catch up.
- **Phase A** — remove the persona-editor's `Runs after` form, the
  cycle / self-parent / unknown-parent validation in `updatePersona`,
  and the `wouldCreateCycle` helper.
- **Phase B** — `sendPlanner` returns only `single` / `parallel`;
  `dagExecutor`, the `kind: "dag"` SendPlan branch, and the //order
  command go away. Out-of-flow `@all` / implicit multi-target sends
  collapse to flat-parallel.
- **Phase C** — schema migration drops the `personas.runs_after`
  JSON column and the `persona_runs_after` junction table. The
  `runsAfter` field disappears from `Persona`; legacy edges only
  flow transiently through import paths into the migration service.
- **Phase D** — this ADR + the cleanup of supporting documentation.

## Alternatives considered

- **Keep coexistence indefinitely.** Two ordering primitives raised
  recurring "why are there two ways to do this" questions in
  practice; the deferral doc explicitly framed unification as the
  long-term direction.
- **Run the auto-conversion sweep at migration time as raw SQL.**
  Faithful level-grouping is hard to express in SQL. The lazy-
  on-open trigger plus the import-time trigger together cover every
  realistic upgrade path; stragglers (DBs that skip from pre-Phase-0
  straight to Phase C) lose ordering, but their personas keep
  working — the user can rebuild ordering through the flow editor.
- **Refactor `dagExecutor` into a flat-parallel runner.** The
  flat-parallel path was already in `runPlannedSend`; the executor
  became dead code rather than valuable infrastructure to preserve.

## Tradeoff

Failure cascade differs from the old DAG: with `a → b` and
standalone `c`, `runs_after` skipped `b` if `a` failed and ran `c`
unaffected. After conversion, step 1 = `[a, c]`, step 2 = `[b]` —
`b` now waits for `c` too, and a failed `a` no longer skips `b`
(flows don't cascade across steps). Success-path behaviour is
preserved. The simplification (one ordering primitive instead of
two) outweighs the lost cascade fidelity for the conversational
workflows mchat2 supports.

## Reference

- Issue: #241
- Flow umbrella: #212
- Original DAG normalization: #195
- Derivation function: [`src/lib/flows/derivation.ts`](../../src/lib/flows/derivation.ts)
- Auto-migration service: [`src/lib/conversations/migrateRunsAfterToFlow.ts`](../../src/lib/conversations/migrateRunsAfterToFlow.ts)
