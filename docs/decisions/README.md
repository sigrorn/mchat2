# Architecture Decision Records

One file per decision, numbered sequentially. Each captures the decision,
the alternatives considered, and the tradeoff — frozen in time so future
contributors don't have to re-litigate the question.

## Recommended reading order on first contact

Read these five first; they're the load-bearing decisions that show up most
often in code review and in [ARCHITECTURE.md](../ARCHITECTURE.md):

1. **[001 — lib → stores/hooks/tauri boundary](001-lib-app-boundary.md).**
   Why `src/lib/app/` exists, why use cases take `*Deps` parameters
   instead of importing stores, what the ESLint boundary rule enforces.
2. **[002 — transactions by default](002-transactions-by-default.md).**
   When multi-step writes get wrapped in `transaction()`. The
   surface-level rule that #267 / ADR 011 later refined.
3. **[011 — section-token transactions](011-section-token-transactions.md).**
   The current model: held-section vs. transaction vs. neither. **Read this
   carefully** — it's the rule that prevents the SQLite-locked bugs the
   project keeps ironing out. Pair with the
   [Transactions and locking rules](../ARCHITECTURE.md#transactions-and-locking-rules)
   section in ARCHITECTURE.md.
4. **[003 — Zod at trust boundaries only](003-zod-at-trust-boundaries.md).**
   Where validation runs (file imports, settings reads, JSON columns) and
   where it doesn't (internal types). Stops Zod from creeping into
   normal-flow code.
5. **[005 — dependency inversion in lib/app](005-dep-inversion-in-lib-app.md).**
   How and why `*Deps.ts` files compose narrow interfaces; how to add a
   new use case without growing the dependency surface.

## Other ADRs in numerical order

- **[004 — `openai_compat` as a meta-provider](004-openai-compat-meta-provider.md).**
  Why one adapter handles N OpenAI-API-shaped backends (Infomaniak,
  Apertus, etc.) instead of one provider per backend.
- **[006 — data layer](006-data-layer.md).**
  Why SQLite + a thin ORM beat the alternatives for a single-user
  desktop app.
- **[007 — typed SQL via Kysely](007-typed-sql-via-kysely.md).**
  Why we generate types from a hand-written schema instead of using a
  full ORM or hand-rolling raw SQL everywhere.
- **[008 — solid-prototype findings](008-solid-prototype-findings.md).**
  Lessons from the original Python/Qt prototype that shaped the rewrite.
- **[009 — runs_after removal](009-runs-after-removal.md).**
  Why the per-persona DAG-edge model was replaced by conversation flows.
- **[010 — apertus native removal](010-apertus-native-removal.md).**
  Why the bespoke Apertus adapter was folded into `openai_compat`.

## Filing a new ADR

When making a non-trivial design choice, write a short ADR (~200 words)
under `docs/decisions/NNN-short-title.md`, numbered after the latest. See
[CONTRIBUTING.md](../CONTRIBUTING.md#adr-policy) for the format.
