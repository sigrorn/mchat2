# Conversation flows + persona role lens

> **Status (2026-05-02):** the experiment shipped; `runs_after` was
> retired per [docs/decisions/009-runs-after-removal.md](decisions/009-runs-after-removal.md).
> The "Coexistence with `runs_after`" section below is preserved as
> historical reference for what was true during the experiment;
> current code has neither the column nor the validator.

## Context

In mchat2 today, **the user is the only `user`-role speaker**. Every persona reply maps to `assistant`-role with a name prefix in the content (see [src/lib/context/builder.ts:131](../src/lib/context/builder.ts#L131)), and a `Run` always executes top-to-bottom in one shot via `executeDag` ([src/lib/orchestration/dagExecutor.ts](../src/lib/orchestration/dagExecutor.ts)). There is no machinery to pause for user input mid-Run, and no way for one persona to receive another persona's reply *as* the user prompt rather than as a third-party assistant message.

This change introduces two orthogonal capabilities, designed together but layered so each ships independently:

1. **Persona role lens** — a per-persona projection map declaring "for me, speaker X should appear as role Y." Lets a persona treat another persona's (or the user's) messages as `user`-role rather than `assistant-with-name-prefix`. Ships independently; immediately useful even without flows.
2. **Conversation flow** — a per-conversation, ordered, cyclic list of steps. Each step is either a `user` step (pause for user input) or a `personas` step (one or more personas that all run before the flow advances). Personas may appear in multiple steps. The flow loops back to step 1 after the last step, with state surviving app reload.

Visibility is **unchanged** — the existing matrix governs who-sees-what regardless of flows. Flows only govern *ordering* and *role projection*.

Status: **experimental**. Ships visibly, no feature flag, with the new editor labelled "experimental."

**Branch policy** (one-off override of the project's standing "work on main" rule): all work for this feature lands on a dedicated branch (suggested name `flows`), not `main`. After the experiment, we'll decide whether to merge into main, keep it parked on the branch, or discard.

## The motivating example: an NVC coach

To make concrete what flows enable that today's mchat2 cannot:

> **Goal**: practice a difficult conversation with the help of a non-violent-communication coach.
>
> **Players**: GPT plays the *opponent* (someone you're in conflict with). Claude plays the *NVC coach* (private to you).
>
> **Flow per round**:
> 1. GPT makes an argument
> 2. **You** draft a rebuttal
> 3. Claude reviews your rebuttal, points out where it strays from NVC principles
> 4. **You** refine the rebuttal based on the coach's feedback
> 5. Refined rebuttal goes to GPT, who counter-argues
> 6. Loop back to step 1

**What today's mchat2 can't do here**:
- The user is the only `user`-role speaker. Claude (the coach) sees your rebuttal as a regular user message — *fine* — but it also sees GPT's argument as `assistant: GPT: <argument>`, framed as if GPT were Claude's peer. Claude needs to see GPT's argument as background context that the user is responding to, not as Claude's own conversational partner.
- There is no notion of "control returns to the user between steps." When you `@all`, every selected persona replies in parallel and the user types again. There is no way to say "after GPT, pause; after my rebuttal, route only to Claude; after Claude, pause again; after my refinement, route only to GPT."
- Claude's coaching is supposed to be private to you. Today this would require carefully configuring the visibility matrix, but you'd have to know to do that.

The NVC scenario combines all three problems mchat2 has: rigid role mapping, no control flow, and visibility that's correct-but-easy-to-misconfigure. Flows + role lens are the smallest set of additions that make this possible.

## Architectural principle (the most important section)

Flows are a **planner / cursor layer above the existing send machinery**, not a parallel pipeline.

A flow step's execution is a normal `runPlannedSend` call where the resolved targets equal the step's persona-set. The flow executor advances a cursor (`current_step_index`); the existing pipeline produces the bubbles, records lineage, fires post-response checks, runs auto-title, etc. There is no `flowExecutor` that calls `runOneTarget` directly — that would bypass `recordSend`, `postResponseCheck`, and the Run/RunTarget/Attempt authority established in #210.

The role lens lives entirely inside `buildContext`. It does not touch any orchestration code.

Two consequences of this layering:
- A flow inherits any future improvement to `runPlannedSend` for free.
- The flow data model is small: cursor + step list. All lineage stays in `runs` / `run_targets` / `attempts`.

## Coexistence with `runs_after`

For the experimental ship, flows and `runs_after` **coexist**. Eventual unification (one ordering primitive, one UI surface) is the long-term goal but requires its own compatibility work — implicit sends, command interactions, snapshot import — and gets a follow-up issue with its own ADR rather than riding on the flow experiment.

What ships in this work:

- **`runs_after` stays untouched** — the column, junction table, persona editor field, and `wouldCreateCycle` validator all remain functional.
- **Flows are the new primitive on top.** A conversation can have a flow attached (it's the source of ordering for flow-step execution) or not (today's `runs_after`-driven DAG continues to apply).
- **No auto-migration.** Conversation load does not mutate existing data. Snapshot import does not translate.
- **User-triggered import** lives in the flow editor (slice 5): an "Import from `runs_after` rules" button that calls `derivedFlowFromRunsAfter` (slice 2), populates the editor with the derived flow, and on save *optionally* clears the rules. The user explicitly chooses when (and whether) the cutover happens.

When a flow IS attached, runtime behavior is:

- **Flow-step execution**: the resolved targets equal the step's persona-set; `runs_after` edges between them inside `runPlannedSend` still fire (codex's preferred default — the flow contributes target selection, not orchestration internals).
- **Implicit / out-of-flow sends** (e.g. user types without `@-target`-ing the next step): fall through to today's path. `runPlannedSend` resolves to the conversation's selected persona set with `runs_after` edges intact. The flow stays paused.

This means the system always has *some* defined ordering — either the flow (when matched) or `runs_after` (when not) — and never both layered.

**The runs_after deprecation question is explicitly out of scope** for this experiment. It will be tracked as a separate issue once flows have been validated in production. That issue's prerequisites: prove flow coverage of `@all`, implicit selection, slash commands, snapshot round-trip, and edit/replay; then design the cutover (likely user-triggered import + opt-in editor-field removal); then schedule the schema drop. None of that lives here.

## Data model

```
personas
  + role_lens TEXT NOT NULL DEFAULT '{}'
    -- JSON map: speakerKey → "user" | "assistant"
    -- speakerKey is a persona-id or the literal "user".
    -- (system promotion was considered; deferred — see Open questions.)

flows
  id            TEXT PRIMARY KEY
  conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE CASCADE
  current_step_index INTEGER NOT NULL DEFAULT 0

flow_steps
  id            TEXT PRIMARY KEY
  flow_id       TEXT NOT NULL REFERENCES flows(id) ON DELETE CASCADE
  sequence      INTEGER NOT NULL
  kind          TEXT NOT NULL CHECK (kind IN ('user', 'personas'))
  UNIQUE (flow_id, sequence)

flow_step_personas
  flow_step_id  TEXT NOT NULL REFERENCES flow_steps(id) ON DELETE CASCADE
  persona_id    TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE
  PRIMARY KEY (flow_step_id, persona_id)

runs
  + flow_step_id TEXT NULL REFERENCES flow_steps(id) ON DELETE SET NULL
    -- non-NULL only for runs created by flow execution.
    -- Lets edit/replay rewind compute "which step produced this message"
    -- without guessing from persona_id (ambiguous when a persona appears
    -- in multiple steps).
```

Service-layer validation rejects:
- `personas` steps with no associated personas
- consecutive `user` steps (the cursor would never advance)

Snapshot export keys role-lens entries by **persona name, not id**, mirroring the visibility-matrix export pattern. Import re-maps to the freshly-allocated persona ids.

## Slice plan

Sub-issues filed under one umbrella issue (`Conversation flows + role lens`). Each slice is shippable on its own. Each follows the project test-first workflow.

### Slice 1 — Role lens (ships independently)

The whole role-lens stack, end to end. Ships value on its own — you can use a lens for things unrelated to flows (e.g. a "summarizer" persona that sees the chat as if all speakers were the user).

- New migration: `personas.role_lens TEXT NOT NULL DEFAULT '{}'`.
- Schema + persona type updated; persona service handles round-trip.
- **Refactor [builder.ts](../src/lib/context/builder.ts) to use an intermediate projected-entry shape**:

  ```ts
  type ProjectedEntry = { role: "user" | "assistant"; content: string; speakerKey: string; sourceInfo: SourceInfo };
  ```

  This unifies the two parallel arrays (`ChatMessage[]` + `SourceInfo[]`) that `truncateToFit` consumes today. Lens application + normalization + truncation all transform `ProjectedEntry[]` in lockstep, so messages and source metadata can never drift. The existing role-mapping site at [builder.ts:131](../src/lib/context/builder.ts#L131) becomes the *projection* step that produces the intermediate; emission of `{ChatMessage[], SourceInfo[]}` happens at the very end.

- **Lens application** within the projection step: look up the source `speakerKey` in `persona.roleLens`. If overridden to `"user"`, set the entry's role to `"user"`. Default (empty lens) preserves today's behavior bit-for-bit.
- **Speaker-identity rule** (codex refinement): role-projection must never silently erase attribution. *Persona* speakers projected to user-role keep their `"<name>: "` prefix in content. The *human user*'s own messages stay raw (no prefix). The `speakerKey` field on `ProjectedEntry` carries the data; prefix rendering happens at content-emit time.
- **Normalization pass** after lens application. Anthropic 400s on consecutive same-role messages; OpenAI tolerates but it's undocumented. Collapse consecutive same-role entries into one — content joined with `\n\n` (name-prefixes preserved as above), `sourceInfo` merged so truncation remains accurate, `speakerKey` becomes `"merged"` (or similar sentinel) for the collapsed entry. Compose with the existing trailing-assistant workaround at [builder.ts:156](../src/lib/context/builder.ts#L156).
- Snapshot export/import: lens entries keyed by speaker name, remapped on import.
- Tests pin: empty lens preserves today's emission exactly; single override to `user`; multiple overrides; persona prefix preserved through projection + normalization; human user stays unprefixed; consecutive same-role entries collapse into one with merged source info; trailing-assistant invariant preserved; truncation token accounting agrees with pre-refactor numbers on a fixture conversation.

### Slice 2 — Flow schema, repo, types (no behavior)

- New migration: `flows`, `flow_steps`, `flow_step_personas` tables; `runs.flow_step_id` column.
- Kysely table types in [schema.ts](../src/lib/persistence/schema.ts).
- `Flow`, `FlowStep` types in `src/lib/types/flow.ts` (new file).
- New repo: `src/lib/persistence/flows.ts` (Kysely-backed; `getFlow`, `upsertFlow`, `setStepIndex`, `replaceSteps`).
- Service layer enforces the validation rules above (no empty `personas` steps, no consecutive `user` steps).
- **Pure function `derivedFlowFromRunsAfter(personas: Persona[]): FlowDraft`** in `src/lib/flows/derivation.ts` (new file). Implements level-grouping topological sort. No DB access; transforms a persona array into a flow shape. Used by the slice-5 "Import from `runs_after` rules" editor button. Tests pin canonical fixtures: linear chain, diamond (a → {b, c} → d), disconnected components (two independent chains), single-persona conversation, persona with no `runs_after` placed at level 0.
- Snapshot bundling: flow definition (when present) serialized alongside personas, persona references keyed by name. Legacy snapshots without a flow definition import as-is — `runs_after` data is preserved untouched, no auto-translation. Users can run the editor's import button after-the-fact if they want.
- Tests pin: schema round-trip, validation rejections, snapshot export/import preserves both flow + lens with persona-name remapping, legacy snapshot without flow imports without modification to `runs_after`.

### Slice 3 — Flow-aware target resolution wrapper

- Keep [resolver.ts](../src/lib/personas/resolver.ts) pure. Flow awareness is a *wrapper* in the send pipeline.
- New `@convo` token resolves to "the next flow step's persona-set" (when the flow is at a `personas` step; no-op otherwise).
- `@all` is flow-aware via the wrapper: when a flow is active and the next step is `personas`, narrows from "all visible personas" to the step's set.
- Single-persona `@target` is unchanged — does not advance the flow, does not cascade. Confirmed semantics: only multi-target invocations interact with flows.
- Tests pin: `@convo` resolves correctly per cursor position; `@all` narrows when flow active; `@x` does not advance the flow.

### Slice 4 — Flow execution via `runPlannedSend`

**Prelude — extend the orchestration result contract.** Today [runPlannedSend.ts](../src/lib/app/runPlannedSend.ts) returns `{ ok }`; per-target outcomes are inferred after the fact by reading freshly-written message rows. Flow advancement can't rely on that — it'd couple cursor logic to projection details. Before any flow logic, extend the return:

```ts
outcomes: Array<{
  targetKey: string;
  kind: "completed" | "failed" | "cancelled" | "skipped";
  messageId: string;
}>
```

`"skipped"` covers DAG descendants whose ancestor failed and cascaded a skip — possible inside a flow `personas` step when the step's induced subgraph has `runs_after` edges. The flow-cursor rule (below) treats any non-`completed` outcome as "stay at current step."

`recordSend` (and siblings) gains an optional `flowStepId` parameter; when present, it's stamped on the `runs` row created during recording. The flow_step_id stamping seam is at the recordSend call site in `sendMessage`, *not* inside `runPlannedSend` (which stays purely about orchestration). This prelude also cleans up sendMessage's existing after-the-fact inference — useful even if the flow work is later abandoned.

**The flow wrapper itself**:

- `FlowReadDeps` / `FlowWriteDeps` slice added to [lib/app/deps.ts](../src/lib/app/deps.ts). `lib/app/*` use cases never import `flowsRepo` directly.
- Modify [src/lib/app/sendMessage.ts](../src/lib/app/sendMessage.ts): after persisting the user message and resolving targets, check whether the conversation has a flow attached and is at a `user` step. If the resolved target-set matches the next step's persona-set:
  - Advance cursor by one (now at `personas` step)
  - Dispatch via the same `runPlannedSend` path as today, with the step's persona-set as the targets — **no separate flow executor**
  - Pass the active step id to `recordSend` so the resulting Run is stamped with `flow_step_id`
  - Inspect the `outcomes` array: if every entry is `"completed"`, advance cursor to the next step; if any entry is `"failed"`, `"cancelled"`, or `"skipped"`, **stay** at the current step (the user can retry the failed bubble or re-send to re-execute the step)
  - If the next step is also `personas` (consecutive bot turns), recurse — the flow auto-chains until it reaches the next `user` step or wraps to step 0.
- **Out-of-flow / implicit sends fall through to today's path.** When the user types without `@-target`-ing the next step (or the conversation has no flow attached), `sendMessage` calls `runPlannedSend` with the conversation's selected persona set; `runs_after` edges still apply. The flow stays paused. No silent ordering loss.
- App reload: read `flow.current_step_index`; UI restores. No in-flight stream state to restore (matches today's "no mid-stream persistence" stance).
- Composer badge: when at a flow user step, show "Flow: → [next-personas]" hint near the input.
- Tests pin: matching send advances flow; non-matching send leaves flow paused (and runs through today's `runs_after` path with ordering intact); reload preserves position; `failed`/`cancelled`/`skipped` outcome keeps cursor at current step; `flow_step_id` is stamped on the Run via `recordSend`; partial-DAG inside a flow step with one-failure-skips-descendant produces the right outcome set.

### Slice 5 — UI editor

- New component `src/components/FlowEditor.tsx` (separate modal/page).
- Linked from a small "Edit conversation flow" link at the bottom of the personas panel.
- Editor renders an ordered list of steps; user can:
  - Add / remove / reorder steps
  - Toggle each step's kind (`user` vs `personas`)
  - For `personas` steps, multi-select participating personas
  - For each persona used in any step, set its `roleLens` (multi-select: which speakers map to `user`-role from this persona's POV)
- **"Import from `runs_after` rules" button**, visible only when the conversation has personas with non-empty `runs_after` and no flow yet attached. Clicking calls `derivedFlowFromRunsAfter` (slice 2), populates the editor with the derived flow, and asks the user to confirm. On save: the flow is persisted; an inline checkbox controls whether `runs_after` rules are also cleared (default off — explicit opt-in to deprecate the legacy ordering for that conversation).
- **Visibility-implication preview**: for each persona in the flow, show "with the current matrix, persona X *will* see persona Y's flow output — proceed?" The NVC scenario fails silently if the user forgets to hide the coach from the opponent; the editor surfaces this proactively.
- Header carries an "experimental" badge.
- All edits go through `flowsRepo.upsertFlow` / `replaceSteps` and `personasRepo.update`.
- **Persona editor stays as-is for now.** The `runs_after` form section remains; the `wouldCreateCycle` validator stays. Removing them is a follow-up issue that requires a separate ADR (proving flow coverage of `@all`, implicit sends, slash commands, snapshot import — see "Coexistence with `runs_after`").

### Slice 6 — Edit/replay flow rewind

- Modify [src/lib/app/replayMessage.ts](../src/lib/app/replayMessage.ts): if the conversation has a flow attached, after truncating messages, look up the truncated runs' `flow_step_id`s, and reset `flow.current_step_index` to one *before* the earliest such step (i.e. back to the user step that fed it). Then continue with today's replay path — `runPlannedSend` will see the flow active and route through the slice-4 wrapper.
- For [retryMessage.ts](../src/lib/app/retryMessage.ts): no rewind. Retry replaces a single failed attempt within the same RunTarget; the Run's `flow_step_id` stays the same. Cursor unaffected.
- Tests pin: edit a user message at flow round 2 rewinds the cursor to the corresponding user step; replay re-executes forward; retry of a flow-step bubble does not advance or rewind the cursor.

## Files I expect to touch

| Slice | Files |
|---|---|
| 1 | [migrations.ts](../src/lib/persistence/migrations.ts), [schema.ts](../src/lib/persistence/schema.ts), [persona.ts](../src/lib/types/persona.ts), [personas service](../src/lib/personas/service.ts), [snapshotImport.ts](../src/lib/conversations/snapshotImport.ts) (+ [snapshot.ts](../src/lib/conversations/snapshot.ts) export sibling), [builder.ts](../src/lib/context/builder.ts) |
| 2 | [migrations.ts](../src/lib/persistence/migrations.ts), [schema.ts](../src/lib/persistence/schema.ts), `src/lib/types/flow.ts` *(new)*, `src/lib/persistence/flows.ts` *(new)*, `src/lib/flows/derivation.ts` *(new)*, [snapshotImport.ts](../src/lib/conversations/snapshotImport.ts) + [snapshot.ts](../src/lib/conversations/snapshot.ts) |
| 3 | @-target parser + flow-aware wrapper above [resolver.ts](../src/lib/personas/resolver.ts), [sendPlanner.ts](../src/lib/orchestration/sendPlanner.ts) |
| 4 | [sendMessage.ts](../src/lib/app/sendMessage.ts), [deps.ts](../src/lib/app/deps.ts), [runPlannedSend.ts](../src/lib/app/runPlannedSend.ts), Composer (badge) |
| 5 | `src/components/FlowEditor.tsx` *(new)*, `PersonaPanel.tsx` (flow-editor link), MatrixPanel for the visibility preview |
| 6 | [replayMessage.ts](../src/lib/app/replayMessage.ts) |

## Existing functions / utilities reused

- `runPlannedSend` ([runPlannedSend.ts](../src/lib/app/runPlannedSend.ts)) — the flow executor is just a wrapper that calls this; no new orchestration code is added.
- `runOneTarget` ([runOneTarget.ts](../src/lib/app/runOneTarget.ts)) — called transitively via `runPlannedSend`; flows never call it directly.
- `buildContext` ([builder.ts](../src/lib/context/builder.ts)) — extended in slice 1 with role-lens application + normalization; remains the single context-build entry point.
- `recordSend` / `recordReplay` / `recordRetry` ([orchestration/](../src/lib/orchestration/)) — flow-step-produced Runs go through these unchanged. Authority semantics from #210 carry over for free.
- `markMessagesSuperseded` ([messages.ts](../src/lib/persistence/messages.ts)) — replay rewinding messages still uses today's superseded marker; no new mechanism.
- `repoQueryCache` (#211 pattern) — flow state lives at `["flow", conversationId]`; cursor changes update the cache via the same `cacheUpdate` pattern used by other repos.
- Snapshot import/export pipeline in [src/lib/conversations/](../src/lib/conversations/) (`snapshot.ts` + `snapshotImport.ts`) — extended, not replaced.

## Open questions

Earlier rounds folded resolved items into the slices directly. For traceability:

- *speaker-identity preservation under projection* → slice 1 ("Speaker-identity rule")
- *runPlannedSend result contract* → slice 4 prelude (now includes `"skipped"`)
- *flow_step_id stamping seam* → slice 4 prelude
- *projected-entry intermediate for truncation parity* → slice 1 (refactor)
- *SourceInfo merge semantics for collapsed entries* → slice 1 (`pinned` = any-source-pinned; `userNumber` = `null` for collapsed)
- *flow persona steps vs runs_after DAG* → flows and `runs_after` **coexist** (see "Coexistence with `runs_after`"). Within a flow `personas` step, `runs_after` edges between the step's members still fire inside `runPlannedSend`. Out-of-flow / implicit sends fall through to today's path with `runs_after` ordering intact. Replacement is deferred to a follow-up issue.
- *`runPlannedSend` outcomes for skipped DAG nodes* → outcome union includes `"skipped"`; flow cursor rule: any non-`completed` outcome keeps cursor at current step
- *auto-migration of `runs_after` on conversation load* → **dropped**. Migration is user-triggered via the flow editor's "Import from `runs_after` rules" button (slice 5). Conversation load is read-only.
- *snapshot auto-translation of `runs_after` to flow* → **dropped**. Snapshots without a flow definition restore as-is; users can run the editor's import button after-the-fact.
- *doc-path stale references* → fixed (`resolver.ts` → `src/lib/personas/`; snapshot files → `src/lib/conversations/`)

Out-of-scope follow-ups (separate issues, not blocking):

- **`runs_after` deprecation track** — once flows have been validated in production, file a separate issue + ADR proving flow coverage of `@all`, implicit sends, slash commands, snapshot round-trip, and edit/replay; design the cutover (likely opt-in editor-field removal); schedule the schema drop. None of that lives in this experiment.

The remaining genuinely-open questions:

1. **Retry of a flow-step bubble while the cursor has advanced**
   User produces step-3 bubble, flow advances to step 5, user retries the step-3 bubble. The retry inherits the same `flow_step_id` and produces a new attempt at step 3. Cursor stays at 5. Is that the right behavior, or should retrying a stale-step bubble be blocked / warn the user?

2. **`system` lens projection**
   Considered and deferred for v1. Ship lens with `user | assistant` only. Add `system` later if a real use case demands it (would change truncation order and safety boundaries; not load-bearing for NVC).

3. **Naming**
   Codex review suggested "context projection" instead of "role lens." Kept as **role lens** because with `system` deferred, lens is purely role mapping; "projection" overstates the scope. Revisit if `system` lens lands. (Note: the *internal* intermediate is called `ProjectedEntry`, since at that layer it really is a projection — both transformations live there.)

4. **Multi-flow per conversation**
   The schema enforces 1:1 (`flows.conversation_id UNIQUE`). If a use case for multiple parallel flows surfaces, the FK becomes a regular index — but no current scenario justifies the complexity.

## Verification

Per-slice unit tests (each slice ships with its own test commit, per the project workflow):

- **Slice 1** — `buildContext` lens application: empty lens preserves today's behavior; single override; multiple overrides; normalization collapses consecutive same-role entries; trailing-assistant invariant preserved; snapshot round-trip preserves lens entries with persona-name keys.
- **Slice 2** — `flowsRepo` round-trip; validation rejections (empty `personas` step, consecutive `user` steps); snapshot export/import preserves flow with persona-name remapping; CASCADE deletes work.
- **Slice 3** — `@convo` resolves to next-step persona-set; `@all` narrows when flow active; `@x` doesn't advance; resolver itself stays pure (no flow imports).
- **Slice 4** — matching send advances flow; non-matching send leaves flow paused (and runs through today's `runs_after` path with ordering intact); reload preserves position; any non-`completed` outcome (`failed` / `cancelled` / `skipped`) keeps cursor at current step; flow-step Runs are stamped with `flow_step_id`; flow chains through consecutive `personas` steps automatically; partial-DAG inside a step with one-failure-skips-descendant produces the right outcome set.
- **Slice 5** — editor round-trip persists definition; visibility-preview surfaces the right warnings; "Import from `runs_after` rules" button populates the editor with the derived flow; on save with the clear-rules checkbox unticked, `runs_after` data is preserved.
- **Slice 6** — edit at flow round-2 rewinds cursor to the corresponding user step; replay re-executes forward; retry of a flow-step bubble does not move the cursor.

**Manual end-to-end** — full NVC scenario:

1. Set up two personas (GPT-as-opponent, Claude-as-coach). Set Claude's lens to remap GPT and the user to `user` role.
2. Configure visibility matrix so GPT cannot see Claude. Verify the flow editor's visibility-preview surfaces no warnings; intentionally break the matrix and verify a warning appears.
3. Build a flow: `[user, GPT, user, Claude, user]`. Loops back to step 1.
4. Send "what do you think about X?" → GPT replies as opponent → input returns → user types rebuttal → Claude reviews (verify Claude's API call shows GPT's argument and the user's rebuttal as user-role; no consecutive same-role messages after normalization) → input returns → user refines → GPT counter-argues → loop continues.
5. Close app mid-cycle at a user step; reopen; verify the input box is still in flow-user mode at the same step.
6. Edit the user's first rebuttal; verify the cursor rewinds and replays from there; verify post-edit `flow_step_id` is correct on the new Runs.
7. Retry one of GPT's bubbles after the flow has advanced — verify it produces a new attempt at the original step without moving the cursor.
8. Export snapshot; import into a fresh conversation; verify flow + lenses round-trip with persona ids correctly remapped.
9. Take a snapshot that has `runs_after` rules but no flow attached, import it; verify `runs_after` data is preserved and no flow is auto-created. In the imported conversation, open the flow editor and verify the "Import from `runs_after` rules" button is offered; click it and confirm the derived flow matches expectations.

**Build hygiene** — `tauri build` at the end to confirm no Rust-side regressions. **Per-slice push + version bump** per the project workflow.
