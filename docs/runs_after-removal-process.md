# Process for removing `runs_after`

## Status

**Deferred.** Pre-read for when the conversation-flow experiment (#212) has been validated in production and the question of unifying ordering primitives comes up.

## Why this document exists

The flow experiment ([docs/convo.md](convo.md)) deliberately chose **coexistence** with `runs_after` rather than replacement. The experimental ship leaves `runs_after` columns, junction tables, persona-editor UI, and the `wouldCreateCycle` validator all functional. Flows are layered on top.

The user-facing case for unification — "two ordering primitives is confusing; why are there two ways to do this?" — is real and remains the long-term direction. But removing `runs_after` is a product-level compatibility change with multiple non-obvious surface areas, and bundling it into the flow experiment was overreach. This document captures what would need to be true before triggering the removal, so it doesn't have to be re-derived later.

## When to revisit

When all of the following are true:

- Conversation flows have shipped and are merged to main (i.e. the `flows` branch experiment was successful, not parked or abandoned)
- The flow editor is the user's natural way to express ordering for any new conversation
- No active workflow depends on `runs_after` ordering that flows can't express
- At least one minor-version cycle has passed since flows reached main (so there's been time for issues to surface)

If the flow experiment is parked or discarded, this document becomes irrelevant — `runs_after` stays as the only ordering primitive.

## Pre-removal checklist

The unification must demonstrably cover everything `runs_after` does today. File a separate issue (with its own ADR under `docs/decisions/`) and verify each of the following before removing UI or schema:

### Behavioral coverage

- [ ] **`@all` sends**: a flow with one `personas` step containing all selected personas reproduces today's `@all` ordering when those personas have `runs_after` edges. (Today: `runPlannedSend` evaluates the DAG. With flow + `runs_after` cleared: same behavior expected, since the flow step's induced subgraph would be edgeless.) Decide: does the editor's import-from-rules flow (#218) preserve the DAG semantics, or just the level-grouping?
- [ ] **Implicit sends**: when the user types without `@-target`-ing the next flow step, today's path falls through to `runPlannedSend` with `runs_after` ordering. Once `runs_after` is gone, implicit sends become flat-parallel unless the flow handles them. Decide the design: do implicit sends become flow-aware (auto-advancing if the selected set matches a step), or is fall-through dropped, or something else?
- [ ] **Slash commands**: any command that triggers a send must work the same way — or be explicitly redesigned — under flows. Audit `lib/commands/handlers/` for command paths that hit `runPlannedSend` / `runs_after`-dependent ordering.
- [ ] **Snapshot import/export**: legacy snapshots carrying `runs_after` but no flow definition still need a clean import path. The import flow's "Import from `runs_after` rules" button (#218) works for live conversations; document the equivalent for snapshot import (auto-translate, prompt, skip).
- [ ] **Edit / replay**: edit a user message in a conversation that originally used `runs_after`. Today's replay re-evaluates the DAG. After removal, the flow's rewind path takes over. Verify equivalence.
- [ ] **Retry**: same — verify retry semantics on a `runs_after`-ordered conversation still work after the data is gone.

### UI coverage

- [ ] Persona editor without the `runs_after` field is not missing essential workflows. Specifically: a user creating a brand-new conversation can express ordering through the flow editor as easily as they could through `runs_after` today. Includes evaluating: does the flow editor need a "quick chain" affordance for the common case "everyone runs after the previous one"?
- [ ] The flow editor's "Import from `runs_after` rules" button has been used by enough conversations that the import path is exercised, not theoretical.

### Migration coverage

- [ ] Decide the migration trigger: passive (next conversation load offers a banner), active (one-time sweep), or user-only (only via the editor button). Each has tradeoffs (passive is invasive but thorough; user-only leaves stragglers).
- [ ] Schedule the migration. A conversation that has `runs_after` set but the user never opens it will never trigger user-only migration. Decide whether that's acceptable (those conversations still work — `runs_after` continues to apply) or whether a sweep is needed.

## Removal sequence

Once the pre-removal checklist is satisfied:

### Phase A — Persona-editor UI removal

- Remove the `runs_after` form section from `PersonaPanel.tsx`
- Remove the `wouldCreateCycle` validator from `personas/service.ts` (becomes unreachable once the editor field is gone, since flows can't introduce graph cycles structurally)
- Persona service stops accepting `runsAfter` mutations on update
- Persona schema export-on-save still emits `runs_after` (for backward-compat reads of older mchat2 versions); persona schema import-on-load still reads it (so older conversations don't break)

### Phase B — Read-path removal

- `runPlannedSend` and `sendPlanner` stop consulting `runs_after`. Out-of-flow / implicit sends flat-parallel by default (or whatever was decided in the implicit-sends design).
- Update `buildContext` and any other read path that touched `runsAfter` arrays.
- All snapshot import paths force a `derivedFlowFromRunsAfter` translation: legacy snapshots cannot restore without converting.

### Phase C — Schema removal

- New migration drops the `personas.runs_after` column and the `persona_runs_after` junction table from #195.
- Drop the related Kysely schema entries.
- Drop the Zod schemas for runs-after JSON encoding (if any remain).
- Drop the dual-write code path (legacy JSON column writes alongside relational table) that #195 added as a safety net.

### Phase D — Cleanup

- Remove this document. The deprecation has happened; no future-proofing needed.
- File a brief retro: did the unification land cleanly? What surprised us?

## Open design questions for the future ADR

These don't need answers now — they're prompts for the future-us-reading-this-doc:

1. **Implicit-send behavior.** Today: select personas, type without `@`, all selected personas reply with `runs_after` ordering. Tomorrow without `runs_after`: do they reply in flat parallel, or does the flow's selected-step take over, or something else?

2. **Quick-chain UX.** A common pattern is "everyone runs in sequence" expressible in `runs_after` as `b.runsAfter=[a]`, `c.runsAfter=[b]`, etc. In the flow editor that's *N* `personas` steps each with one persona — verbose. Worth a "convert to chain" / "explode chain" affordance?

3. **Snapshot backwards-compat.** Phase B forces all snapshot imports to translate. But mchat2 v2.X snapshots from before the flow experiment will still carry `runs_after`. Does the importer handle them silently (auto-translate + show a notice), or refuse and direct the user to upgrade snapshots first?

4. **Cycle-detection regression.** `wouldCreateCycle` was the validator that prevented `b.runsAfter=[a]` + `a.runsAfter=[b]`. Once removed, can a new flow even express such a cycle? (Probably not — flow cycles are explicit and intentional via "loop back to step 1," not graph cycles between persona-references.) Verify.

## Reference

- Conversation flow umbrella: #212
- Coexistence section in the flow design: [docs/convo.md](convo.md) → "Coexistence with `runs_after`"
- Original persona DAG work: #195 ("Normalize runs_after → DAG-edges table")
- Cycle validator: `personas/service.ts#wouldCreateCycle`
