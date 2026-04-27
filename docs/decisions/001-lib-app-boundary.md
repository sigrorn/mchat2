# 001 — Use-case layer with an enforced lib → stores/hooks/tauri boundary

Date: 2026-04-27 (retroactive — work landed across [#142](https://github.com/sigrorn/mchat2/issues/142), [#144](https://github.com/sigrorn/mchat2/issues/144), [#146](https://github.com/sigrorn/mchat2/issues/146), [#147](https://github.com/sigrorn/mchat2/issues/147))
Status: Accepted

## Decision

Extract the orchestration that lived in `useSend.ts` (resolve targets, plan DAG, stream, retry, replay, post-response check) into plain async functions under `src/lib/app/`. Each function takes an explicit `*Deps` interface (defined in `src/lib/app/deps.ts`) instead of importing Zustand stores, hook factories, or `@tauri-apps/*` modules. Composition happens in factory functions under `src/hooks/*Deps.ts`, which is the only place that may bridge from React state into the use-case layer.

Enforce the boundary with ESLint `no-restricted-imports` rules: `src/lib/**` may not import from `@/stores/*`, `@/hooks/*`, or `@tauri-apps/*` (the last must go through the `@/lib/tauri/*` shim).

## Alternatives considered

- **Keep orchestration in `useSend`.** The pre-#144 status quo. *Not chosen* because the hook had grown to coordinate persistence, streaming, retry, replay, auto-title, auto-compaction, and store mutation in one place; testing any branch required spinning up the React tree.
- **Class-based service objects.** Group the orchestration into one or more class instances injected via context. *Not chosen* because plain functions + a typed `*Deps` parameter expressed the same thing without the lifecycle ambiguity of "where does the instance get created and how long does it live".
- **A heavier DI container** (InversifyJS, tsyringe). *Not chosen* — orthogonal to the goal, adds a vocabulary the rest of the project doesn't speak, and the dep wiring in `*Deps.ts` factories is short enough to read top-to-bottom.

## Tradeoff

The cost is a layer of plumbing: every store-touching call now hops through a callback in the `*Deps` interface. The benefit is that the layering is *enforceable* — the ESLint rule fails CI when someone reaches across — and the use cases became unit-testable against fakes (used heavily by #168). Given that the hook had become the dominant source of regressions in the chat path, the trade favored the boundary.
