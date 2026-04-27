# 003 — Zod schemas at trust boundaries, not in hot reads

Date: 2026-04-27 (retroactive — work landed in [#165](https://github.com/sigrorn/mchat2/issues/165))
Status: Accepted

## Decision

Use `zod` schemas **only at trust boundaries** — places where data crosses from outside the codebase's authorial control into in-memory types. Boundary set:

- Snapshot import/export (`lib/conversations/snapshot.ts`)
- Persona file import (`lib/personas/importExport.ts`)
- Settings JSON values (`lib/persistence/settings.ts`)
- Conversation JSON columns at repo read time (`visibility_matrix`, `autocompact_threshold`, `context_warnings_fired`, `selected_personas`)
- Message JSON columns (`addressedTo`, `audience`)

Schemas live in `src/lib/schemas/`. On parse failure, soft-fail: log + skip the malformed record (preserves the "import a backup from last week" workflow).

Explicit non-goal: do **not** put zod in hot reads — the message-list rendering loop, streaming token handlers, anywhere a schema runs once per token or per row per render. Those paths use the JS-side type that's already established at boundary parse time.

## Alternatives considered

- **No runtime validation, manual type assertions** (the prior pattern). *Not chosen* — JSON.parse + `as Foo` left every malformed-input bug undetected until a downstream `undefined` reference threw.
- **Validate everywhere, including hot reads.** *Not chosen* — Codex review (2026-04-26) explicitly flagged the message-list loop as a place where schema parsing would be pure overhead. Type safety inside the codebase is enforced at compile time; runtime validation is for *boundaries*.
- **Use `io-ts` or hand-rolled validators.** *Not chosen* — `zod` was already a `package.json` dependency (~60 KB minified, acceptable for a desktop bundle), the API is more discoverable, and chaining `.safeParse()` matched the soft-fail policy directly.

## Tradeoff

Soft-fail trades visibility for resilience: a malformed record is logged but the surrounding import keeps going. The risk is silent data loss on a corrupt file. Mitigation: every soft-fail path emits a console warning identifying the field and reason, so a developer who looks at logs can spot the drift even though the user-facing flow continues.
