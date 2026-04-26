# 007 — Typed SQL via Kysely (pilot)

Date: 2026-04-27
Status: Pilot (#188 → #189)

## Decision

Adopt **Kysely** as the typed-SQL builder for new and migrated repositories. Pilot scope: `messages.ts` (#190) and `conversations.ts` (#191). If both feel right after migration, file follow-ups for the remaining repos. The schema source-of-truth is a **hand-authored** `src/lib/persistence/schema.ts` mirroring the v14 migration set.

A custom Dialect (`MchatKyselyDialect`) bridges Kysely's sync-driver expectation onto the existing async `SqlImpl` abstraction. This keeps the `__setImpl` test seam untouched — sql.js works in tests, Tauri plugin works in production, no new fork needed.

## Alternatives considered

**Drizzle.** Comparable type safety, more "ORM-shaped" API. Currently has weaker custom-dialect ergonomics for non-Node.js drivers — wiring it onto Tauri's plugin would require a heavier shim than Kysely's. *Not chosen.*

**Codegen schema from migrations.** Run a tool over `MIGRATIONS` to extract column types, output a generated `schema.ts`. Cleaner in theory — schema is always exactly what was migrated — but the build pipeline gains a step that runs on a hand-written DSL (our migrations are flat SQL strings, not a schema-describing language). Hand-authoring stays simpler at the current scale; revisit if/when migrations exceed ~20 versions. *Not chosen for now.*

**Stay with raw `sql.execute` + hand-written `Row` interfaces.** What we have today. The class of bug this replaces is `Row` interface drift: the SQL adds a column, the Row interface doesn't, and the production code returns silently-wrong data. #165's zod work papered over this at runtime; Kysely catches it at compile time. *Not chosen — this is the whole reason for the pilot.*

## Tradeoffs

- **+~25 kB gz** for `kysely` (no peer deps). Acceptable for the type-safety win on the persistence layer.
- **Custom Dialect maintenance burden.** ~80 lines. Kysely's `Dialect` API is small and stable; we maintain `MchatKyselyDialect` ourselves rather than hoping a community SQLite-async dialect lands.
- **Schema drift risk.** With hand-authored schema, a developer can add a migration column and forget to update `schema.ts`. The dual-write tripwire from #187 doesn't catch this — a typed-row mismatch only fails at the call site that uses the missing column. Mitigation: `tests/unit/persistence/schemaParity.test.ts` (added in this issue) asserts the migrations and the schema agree on column lists per table.

## Migration order

1. **#189** (this issue): install + dialect + schema + ADR + smoke test.
2. **#190**: `messages.ts` — largest + hottest repo.
3. **#191**: `conversations.ts` — different shape (more JSON columns).

Public exports keep their signatures across the pilot. Existing tests must continue to pass with no test-side changes. If a friction shows up that can't be resolved cleanly, document it in the ADR and stop the pilot — three repos partially typed is still a win.
