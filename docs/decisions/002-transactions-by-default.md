# 002 — Transactional unit-of-work for multi-step mutations

Date: 2026-04-27 (retroactive — work landed in [#164](https://github.com/sigrorn/mchat2/issues/164))
Status: Accepted

## Decision

Add a small `transaction<T>(fn: () => Promise<T>): Promise<T>` helper at `src/lib/persistence/transaction.ts` that wraps `fn` in `BEGIN IMMEDIATE` / `COMMIT`, rolling back on throw. Apply it to every multi-step mutation that touches more than one row or table:

- `replayMessage`: applyMessageMutation + (formerly) deleteMessagesAfter
- `handlePop`: deleteMessagesAfter + appendNotice
- `handleCompact`: per-persona summary insertion + setCompactionFloor + setLimit
- `importPersonasFromFile`: createPersona ×N + runsAfter patches + identity-pin × N

The helper relies on the singleton `sql` impl from `lib/tauri/sql.ts`; nesting is not supported (no SAVEPOINT) — a single top-level transaction per use case.

## Alternatives considered

- **Per-call `BEGIN`/`COMMIT` strings.** What we had. *Not chosen* because every multi-step site grew its own copy and several forgot rollback on the error branch.
- **Adopt a heavier ORM (Drizzle, Prisma) for its transaction abstraction.** *Not chosen* — the cost (bundle, schema duplication, learning curve) far exceeds the benefit for a single helper. We later picked Kysely [(ADR 007)](007-typed-sql-via-kysely.md) for *typing*, separately, and kept this helper for transactions because Kysely's own transaction API requires nested scope semantics our async-bridge dialect can't honor.
- **Make every repo function automatically transactional.** *Not chosen* because some operations span repos (e.g. compaction touches messages + conversations) and the right scope is the use case, not the repo.

## Tradeoff

This is correctness, not architecture polish — the prior pattern would silently leave the DB inconsistent after a partial failure. The helper is ~15 lines and the discipline is enforced by code review, not tooling. The risk: a developer adds a multi-step mutation and forgets to wrap it. Caught only by reading the diff.

## 2026-05-07 — handleCompact note (issue [#268](https://github.com/sigrorn/mchat2/issues/268))

The original `handleCompact` wrap (per-persona summary insertion + setCompactionFloor + setLimit) was correct for its time. After [#240](https://github.com/sigrorn/mchat2/issues/240) dropped `setLimit`, the outer wrap reduced to a single write — that vestigial wrapper was removed in [ADR 011](011-section-token-transactions.md). The atomicity-needing block was always one frame deeper: `runCompaction`'s body (`shiftMessageIndicesFrom` + per-persona `insertMessageAtIndex` × N+1 + floor move). [#268](https://github.com/sigrorn/mchat2/issues/268) extracted that block into `commitCompactionWrites` and wrapped it in `transaction()`. The shape of this ADR is unchanged; the *site* of the wrap moved from the outer command handler to the inner commit phase, and the floor write joined the same transaction (closing the "floor moves AFTER insertions" failure mode).
