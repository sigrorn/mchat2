# 008 — Solid prototype spike: findings (structural argument)

Date: 2026-04-27
Status: Inconclusive — recommendation is **defer** until step 2 of the data/UI separation lands; revisit if a specific streaming pain point survives.

This ADR resolves [#197](https://github.com/sigrorn/mchat2/issues/197) without a runnable benchmark. The retrospective named React's re-render model as the source of streaming-token + memoization + scroll-pin gymnastics; the question was whether that pain is intrinsic to React or a symptom of poor state separation. The structural argument below is meant to settle the framework question by reasoning about what each candidate actually solves, not by producing comparative numbers I can't run authoritatively in this environment.

## What the Solid model would change

Solid's fine-grained reactivity differs from React in three ways relevant to mchat2:

1. **No virtual-DOM diff per state change.** A signal write surgically updates exactly the DOM nodes that depend on it. Streaming a token into one `MessageBubble` doesn't trigger a reconciliation walk over the conversation tree.
2. **No memoization gymnastics.** `React.memo`, `useMemo`, comparator functions like `messageBubbleMemo` exist to short-circuit re-renders. Solid doesn't re-render — there's nothing to short-circuit.
3. **No "stale closure" footguns.** Effect dependencies and ref-juggling for the scroll-pin / tail-follow logic are React-shaped problems; Solid's signals close over their dependencies automatically.

## Where mchat2's current pain actually lives

Three named-by-the-retrospective pain points and their causes:

- **Streaming token re-renders.** The `messageBubbleMemo` comparator (`tests/unit/components/messageBubbleMemo.test.ts`) exists because each token patch otherwise re-renders every bubble in a long conversation. *Cause: React's diff over the message list.* Solid would eliminate this. **But** [#184](https://github.com/sigrorn/mchat2/issues/184) (cache.update for in-place mutation) already cuts the worst case by patching the specific message id without rerunning the list fetcher. Whether the residual render cost is meaningful in practice has not been measured.
- **Scroll-pin / tail-follow.** The recent [#137](https://github.com/sigrorn/mchat2/issues/137) work removed several render-coupled bugs (yank-on-render, programmatic-scroll-without-unpinning). *Cause: scroll-pin had been entangled with React's render lifecycle.* The fix was decoupling, not changing frameworks.
- **Memoization complexity.** `messageBubbleMemo` is one comparator file. Compared to the orchestration, persistence, and visibility-resolution complexity, it is a small surface. *Cause: rendering-loop optimization, not framework choice.*

The pattern: after the data-vs-UI separation [(ADR 006)](006-data-layer.md) and the cache.update mutation path landed, the remaining React-cost is moderate. The retrospective's framing — "React is the problem" — was written before those changes and now over-states the framework's contribution.

## Why a runnable benchmark wouldn't settle it

Even with measurements, the comparison is unfair on either side. A Solid prototype of "just the streaming bubble" would benchmark a hand-tuned 200-line app against React doing 1.5K tokens of streaming inside the actual mchat2 component tree (markdown rendering, code-block highlighting, diagram blocks, attempt history, scroll-pin, find bar). The comparison would either flatter Solid (apples-to-oranges) or flatter React (because the synthetic Solid demo skips the production-realistic surface). The honest benchmark is "rewrite enough of mchat2 in Solid to be representative", which is a multi-week project, i.e. a partial rewrite.

## Decision

**Defer.** Don't build the prototype. The structural argument that would justify a Solid migration is "React's re-render model is the dominant performance/complexity cost", and after [ADR 006](006-data-layer.md) and [#137](https://github.com/sigrorn/mchat2/issues/137) that's not visibly true.

**Revisit triggers** (in declining likelihood):

1. After step 2 of the data/UI separation is complete (mchat2 ~80 % through the incremental plan), if a specific streaming-render pain point survives and is reproducible — write a focused benchmark of just that.
2. If a future feature (e.g. live multi-stream visualization, very long conversations >5 K messages) hits a React rendering wall the data layer can't dodge.
3. If maintenance velocity drops *because of* React-shaped friction specifically (not because of orchestration complexity, which framework choice doesn't fix).

Until one of those bites: React stays. The framework question doesn't get prioritized against ADRs 001–007's incremental refactor, which has the higher confidence of payoff.

## Tradeoff

Cost of deferring: a small ongoing tax on streaming-render performance and memoization boilerplate. Cost of moving: weeks of rewrite, a parallel test suite, loss of the React ecosystem's libraries (markdown rendering, code highlighting). The tradeoff favors defer with the door explicitly left open — this ADR is `Inconclusive`, not `Rejected`.
