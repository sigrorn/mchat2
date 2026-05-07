# 011 — Section-token transactions

Date: 2026-05-06 (work landed for [#267](https://github.com/sigrorn/mchat2/issues/267))
Status: Accepted

## Decision

Replace the global `inSerializedSection` flag in `lib/tauri/sql.ts` with a section-scoped raw `SqlImpl` threaded into the body of `withSerializedSection` / `transaction`. The public `sql.execute` / `sql.select` always queue — there is no bypass. Section bodies receive a raw impl (and, for transactions, a Kysely instance bound to it) and pass it to every repo call they make. Repo functions reachable from inside a transaction take an optional `dbi: Kysely<Database>` arg defaulting to the global `db`; outside-transaction callers don't change.

## Why

[ADR 002](002-transactions-by-default.md) introduced `transaction()`. [#206](https://github.com/sigrorn/mchat2/issues/206) added the SQL op queue + held-section model after Tauri's plugin-sql v2 (sqlx pool, no busy_timeout, no `connect_with`) surfaced "database is locked" under concurrent demand. The held-section model used a module-scope flag — *every* `sql.execute` call bypassed the queue while a section was open. That worked when only the section's own writes ran during the section. It broke whenever a fire-and-forget DB write started before or during the section: the bypass let the concurrent op land on a different sqlx pool connection, and the writer-lock contention surfaced as `code: 5 database is locked`.

[#267](https://github.com/sigrorn/mchat2/issues/267) was the first manifestation (`void postResponseCheck(...)` racing `//pop`'s `BEGIN IMMEDIATE`). v2.67.1 was the second (auto-title and `setSelection`'s fire-and-forget UPDATE racing `//pop`). Both got patched piecewise by awaiting the offending caller. The pattern was clearly whack-a-mole — six fire-and-forget DB-touching call sites enumerated at v2.67.1, no enforcement against new ones — so the architectural fix was overdue.

## Alternatives considered

- **Patch-each-caller indefinitely.** What we'd been doing. *Not chosen* because the bypass is global and any new `void <db-write>` reopens the race. Two regressions in three weeks.
- **AsyncContext / AsyncLocalStorage to detect "called from inside the section's body."** Would let the bypass stay global while only the body sees it. *Not chosen* — neither AsyncContext (TC39 stage 3) nor AsyncLocalStorage is available in Tauri's webview, and stack-trace heuristics are too fragile across `await` boundaries.
- **Drop SQL transactions entirely; rely on the JS-level queue for atomicity.** *Not chosen* — we'd lose ROLLBACK on failure, which [ADR 002](002-transactions-by-default.md) added specifically for partial-failure correctness.
- **Swap the global impl during the section.** *Not chosen* — same shape as the bug (any caller during the swap window hits the swapped impl, including external ones).
- **Reach for a heavier ORM with built-in transactional connection pinning.** *Not chosen* for the same reason ADR 002 didn't take Drizzle/Prisma — the cost outweighs a localized helper.

## Tradeoff

Surface cost: every repo function reachable from inside a transaction grows an optional `dbi` arg. Today that's `messagesRepo.{appendMessage,applyMessageMutation,markMessagesSuperseded,deleteMessagesAfter,updateMessageContent,listMessages}`, `personasRepo.{listPersonas,getPersona,createPersona,updatePersona}` (plus the `personas/service` wrappers and `identityPin.ensureIdentityPin`), `conversationsRepo.{updateConversation,setCompactionFloor,writeSelectedPersonas,writeContextWarnings,writeVisibilityMatrix}`, and `flowsRepo.{getFlow,upsertFlow}`. The four transaction call sites (`history.ts` //pop, `replayMessage.ts`, `compaction.ts`, `fileOps.ts`) thread `txn.db` through; outside callers are unchanged.

The benefit: the entire class of fire-and-forget-vs-transaction races closes. New `void <db-write>` patterns added in the future cannot trip it — they enter the queue, wait their turn, and never race. No per-callsite review burden.

Discipline cost: a developer adding a multi-step mutation must thread `txn.db` (or `txn.sql`) through every repo call inside the body. Forgetting deadlocks the body waiting on the queue head it already holds. Caught immediately by tests (the test suite exercised every transaction call site through this refactor) and by lint (the unused-`txn` arg warning fires when the body forgets to use it).

## Compaction's vestigial transaction wrapper

`compaction.ts` previously wrapped `setCompactionFloor` in `transaction()`. After [#240](https://github.com/sigrorn/mchat2/issues/240) dropped `setLimit`, that became a single-write transaction — atomicity was already guaranteed by SQLite's per-statement contract, and the wrapper added cost without benefit. Dropped during the section-token refactor; threading `txn.db` through deps for a single write would have been pure plumbing.
