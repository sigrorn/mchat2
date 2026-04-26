# To mchat3 or not to mchat3

A combined finding written 2026-04-26, after two independent reviews
(mine and Codex's) of the same question: with all the architectural
learnings from the retrospective in [`IfIWereTostartOver.md`](IfIWereTostartOver.md),
would it be worth restarting mchat2 from scratch as mchat3?

## TL;DR

**Don't rewrite.** Both reviews converged on the same answer. The
architectural wins from the retrospective are real, but they're
~70-80% achievable inside mchat2 over the next 6-12 months without
losing the working tool, the 799-test safety net, or the 173 issues
of accumulated edge-case fixes. A full rewrite would deliver
foundational cleanliness at the cost of months of feature regression
and a non-trivial risk of second-system bloat.

The retrospective is a refactor roadmap, not a rewrite plan.

## What an mchat3 rewrite would actually gain

Both reviews named the same four buckets (Codex was sharper on
articulation in places — noted inline):

1. **Run / RunTarget / Attempt as a first-class state machine.**
   The biggest single win. Today retry, replay, supersede, partial
   failure, branching are scattered across `orchestration/`,
   `useSend`, `runOneTarget`, `replayMessage`. A first-class `Run`
   containing `RunTarget`s with `Attempt`s and an explicit
   replacement policy unifies all of them. Probably reduces ~30 %
   of orchestration complexity.

   *Codex's framing*: keep all attempts in the data layer, default
   the UI to show only the current attempt with a way to expand
   into history. That separates the structural change (Attempts
   table) from the UX change (default-hide-superseded), which can
   then ship independently. The `//hide` need disappears as a
   side-effect of the data model being right, not as a UI fix.

2. **Persistent app state vs. reactive UI state — clean
   separation.** Today `messagesStore` / `personasStore` /
   `conversationsStore` mix reactive cache, mutation, and
   orchestration. A clean cut routes persistent entities through
   repository APIs (or TanStack-Query-shaped boundaries) and
   leaves Zustand strictly for UI / session state — selected
   conversation, active streams, transient editing flags, panel
   open/closed, scroll/focus. Falls out of this: most of the
   dep-inversion work that #168 just did becomes unnecessary
   because the data layer never reaches into stores in the first
   place.

3. **Typed SQL (Kysely / Drizzle) + zod at every boundary.**
   Eliminates the entire class of manual `Row` interface drift
   bugs. Compile-time catches what #165 had to do at runtime.

4. **Domain primitives first-class from migration v1.**
   - Persona DAG + visibility matrix in the initial schema (today
     six migrations to evolve there).
   - "OpenAI-compatible endpoint + native shims" as the provider
     model from day one (today the conclusion of the three-phase
     #140 refactor).

   *Codex's specific normalization rule*: stable concepts go
   relational (DAG edges, selected personas, run attempts,
   visibility rules, context-warning history); provider-specific
   config stays JSON.

## What the rewrite would cost

- **Re-discovering the polish.** mchat2 has 173 issues of
  accumulated edge-case fixes, many of which are documented only as
  "this works because we noticed it didn't." Examples that took
  multiple iterations: scroll-pin (#137 + 3 follow-ups), autoFocus
  + aria-label (#139), context window edge cases, compaction floor
  / limit interaction, identity pin scoping, copy-with-prefix
  selection, the new low-contrast button class (#172). You will
  rediscover these the hard way.
- **799 unit + 19 E2E tests don't port.** They encode assumptions
  tied to current shapes. Net new tests in mchat3 will reach
  maybe 60 % of the safety net before feature parity.
- **Months without your daily tool.** You're using mchat2 right
  now. For 4-6 months, mchat3 is "almost ready" while you keep
  depending on mchat2.
- **Second-system effect.** With all the architectural learnings
  on the table, the temptation to over-engineer is real — XState!
  Effect.ts! workspace monorepo! The discipline that kept mchat2
  lean came partly from constraints; without those, the second
  one can bloat past usefulness.
- **Realistic estimate**: feature-parity rewrite reaches ~80 % of
  mchat2 in 4-6 months, parity at month 7-8.

## What does NOT justify a rewrite (none are true today)

- Foundational lock-in preventing growth — mchat2 is clean enough
- A single technology pivot needed — Tauri + React + TS + SQLite is right
- User base demanding API-breaking redesigns — single-user, no API
- Maintenance velocity collapsed — we just shipped 4 issues this evening

## The actually-useful path: incremental mchat3 inside mchat2

Roughly 70-80 % of the rewrite's architectural wins are achievable
in mchat2 over the next 6-12 months without losing the tool. Order
by leverage:

| # | Refactor | Size | Notes |
|---|---|---|---|
| 1 | **Run / Attempt state machine** | 2-3 weeks | Highest single ROI. Build the data layer first (Attempts persisted), then layer the UI policy ("show current attempt by default") on top. Start with `replay` (smallest surface), prove the model, then migrate `retry` and `send`. |
| 2 | **TanStack Query (or hand-rolled repo wrapper) for persistent state** | 3-4 weeks, spread out | New code uses the repo layer; existing Zustand stores shrink to UI state as features touch them. Don't migrate all at once. |
| 3 | **Typed SQL pilot via Kysely** | 1-2 weeks | Try `messages.ts` first; if it lands cleanly, migrate the rest of the repo files piecemeal. |
| 4 | **Schema normalization pass** | 1-2 weeks per touch | Pull DAG edges, `selected_personas`, run attempts, visibility rules, `context_warnings_fired` out of JSON into proper tables. Provider config blobs stay JSON. Done lazily as you touch each domain. |
| 5 | **Solid prototype as a fenced-off experiment** | ~1 week | A streaming-bubble standalone demo. Measure whether fine-grained reactivity meaningfully simplifies the streaming UI before any framework decision on the main app. |
| 6 | **`<OutlineButton>` / `<PrimaryButton>` extraction** | ~1 day | #172 was the second instance of low-contrast button text. Stops the class. |
| 7 | **ADRs from now on, retroactively for the last ~5** | ~3-4 hours | openai_compat decisions, the lib/app boundary, the persona DAG model, the transactions-by-default decision (#164), the dep-inversion rule (#168). |

Each is shippable as a normal PR sequence in the existing repo.
By the time you've worked through them, mchat2 looks ~80 % like
mchat3 would have looked, minus the rewrite cost.

## Where the two reviews converged

Both reviews independently reached the same conclusion in the same
order of priority. The convergence is itself a useful signal — when
two passes from different angles agree on "Run/Attempt state
machine first; data-vs-UI state separation second; don't rewrite,"
that's stronger evidence than either pass on its own.

The remaining differences are emphasis and sizing, not direction:

- **Codex** was sharper on:
  - Attempts-as-data vs. current-attempt-shown-as-UI-policy split
  - Specific normalization rule (which JSON blobs should become
    tables, which should stay JSON)
  - Solid prototype as a separable experiment, not a rewrite trigger
- **My pass** was sharper on:
  - Concrete time estimates and ordering for the incremental
    refactor
  - The cost analysis (test-suite re-port percentage, parity
    timelines, lost-tool months)
  - Naming the second-system-effect risk explicitly as the
    rewrite anti-pattern

The combined plan above takes the better-articulated framing from
each review.

## When this doc would be wrong

- If the user base ever grows and starts demanding API-breaking
  changes that mchat2's schema can't accommodate.
- If maintenance velocity collapses on a foundational issue we
  can't refactor around incrementally.
- If a Solid (or other framework) prototype demonstrates a *qualitative*
  improvement in streaming UX that can't be retrofitted.

In any of those cases, revisit. Until then: refactor, don't rewrite.
